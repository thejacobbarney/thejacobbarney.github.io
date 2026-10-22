"""Weekly agent loop. usage: python src/run_agents.py [tuesday|wednesday|thursday|sunday]
Each bot reads only its own folder + the shared snapshot and writes PROPOSALS (status=pending).
Lineup/IR moves are auto-approved; waiver claims and trades wait for the commissioner (src/approve.py)."""
import json, sys, datetime
from common import ROOT, cfg, slug
from personas import PERSONAS
from engine import value, week_score, protected, needed_gain, lineup, OUT_THIS_WEEK
phase = sys.argv[1] if len(sys.argv) > 1 else "tuesday"
c = cfg(); g = c["guardrails"]; overrides = c.get("drop_overrides", {})
if c.get("paused"): sys.exit("PAUSED — no proposals generated.")
snap = json.loads((ROOT/"shared/snapshot.json").read_text()); wk = snap["week"]
now = datetime.datetime.now().isoformat(timespec="minutes")
PROP = ROOT/f"shared/proposals/week{wk}.json"; PROP.parent.mkdir(exist_ok=True)
props = json.loads(PROP.read_text()) if PROP.exists() else []
# re-running a phase replaces that phase's still-pending proposals; approved/rejected stay
props = [p for p in props if not (p["phase"] == phase and (p["status"] == "pending" or (p.get("auto") and not p.get("executed"))))]

# No duplicate claims across bots: anything proposed or approved this week (not rejected) is taken.
claimed = {p["add_id"]: p["team_id"] for p in props if p["type"] == "WAIVER" and p["status"] != "rejected"}
rejected = {(p["team_id"], p["add_id"]) for p in props if p["type"] == "WAIVER" and p["status"] == "rejected"}
order = sorted(c["bot_teams"].items(), key=lambda kv: snap["teams"][kv[0]].get("waiver_rank") or 99)
new, blocked, seen_block = [], [], set()
for tid, b in order:
    team = snap["teams"][tid]; k = PERSONAS[b["persona"]]; roster = [dict(p) for p in team["roster"]]
    def propose(**m): new.append(dict(m, team_id=tid, team=team["name"], persona=k["title"]))
    ir_used = any(p["slot"] == "IR" for p in roster)
    for p in roster:
        if p["inj"] == "INJURY_RESERVE" and p["slot"] != "IR" and not ir_used:
            propose(type="IR", player=p["name"], reason="on NFL IR, frees bench spot"); p["slot"] = "IR"; ir_used = True
    if phase in ("tuesday", "wednesday"):
        claims = sum(1 for v in claimed.values() if v == tid)
        for fa in sorted(snap["free_agents"], key=lambda p: -value(p, k)):
            if claims >= g["max_waiver_claims_per_week"]: break
            if fa["id"] in claimed or (tid, fa["id"]) in rejected or str(fa["inj"]) in OUT_THIS_WEEK: continue
            cands = [p for p in roster if p["pos"] == fa["pos"] and p["slot"] != "IR"]
            if not cands: continue
            droppable = [p for p in cands if not protected(p, roster, k)]
            if not droppable:
                worst = min(cands, key=lambda p: value(p, k))
                if value(fa, k) - value(worst, k) > needed_gain(worst, fa, k):
                    if (tid, worst["id"]) not in seen_block:
                        seen_block.add((tid, worst["id"]))
                        blocked.append((tid, f"wanted {fa['name']} over {worst['name']}: {protected(worst, roster, k)}"))
                continue
            worst = min(droppable, key=lambda p: value(p, k))
            gain, need = value(fa, k) - value(worst, k), needed_gain(worst, fa, k)
            if gain <= need: continue
            why = f"+{gain:.1f} value (needs {need:.1f}), {k['title']} model"
            if str(worst["id"]) in overrides: why += f"; override: {overrides[str(worst['id'])]}"
            propose(type="WAIVER", add_id=fa["id"], add=f"{fa['name']} ({fa['pos']})", drop=worst["name"], drop_id=worst["id"], reason=why)
            roster = [p for p in roster if p["id"] != worst["id"]] + [dict(fa, slot="BE")]
            claims += 1; claimed[fa["id"]] = tid
    if phase in ("tuesday", "thursday", "sunday"):
        lu, used = lineup(roster, k)
        for slot, p in lu:
            if p["slot"] != slot and not (slot == "RB/WR/TE" and p["slot"] in ("RB/WR/TE", "FLEX")):
                propose(type="START", slot=slot, player=p["name"], reason=f"proj {p['proj']}, {p['inj']}")
        for p in roster:
            if p["id"] not in used and p["slot"] not in ("BE", "IR", None, ""):
                propose(type="BENCH", player=p["name"], reason="outscored or out this week")
    if phase == "tuesday" and k["trade_style"] in ("2for1", "buy_low", "value"):
        propose(type="TRADE_IDEA", style=k["trade_style"], reason=f"draft offer; max {g['max_trade_proposals_per_week']}/week")

base = max([int(p["id"].split("-")[1]) for p in props] + [0])
for i, m in enumerate(new, base + 1):
    auto = m["type"] in g.get("auto_approve_types", [])
    m.update(id=f"w{wk}-{i}", week=wk, phase=phase, status="approved" if auto else "pending", proposed=now)
    if auto:
        m["auto"] = True
        d = next((ROOT/"teams").glob(f"{m['team_id']}_*"))
        with open(d/"log.jsonl", "a") as f: f.write(json.dumps(dict(m, decided=now, note="auto-approved lineup/IR"))+"\n")
    if m["type"] == "TRADE_IDEA" and c["my_team_id"] and str(m.get("partner_id")) == str(c["my_team_id"]):
        m["needs_league_review"] = True
props += new
PROP.write_text(json.dumps(props, indent=1))
for tid, msg in blocked:
    d = next((ROOT/"teams").glob(f"{tid}_*"))
    with open(d/"log.jsonl", "a") as f: f.write(json.dumps({"type": "BLOCKED_DROP", "week": wk, "phase": phase, "ts": now, "reason": msg})+"\n")
na = sum(1 for m in new if m.get("auto"))
print(f"{phase}: {na} lineup/IR moves auto-approved, {len(new)-na} proposals pending approval, {len(blocked)} drops blocked by protection")
print("Review: python src/approve.py")
