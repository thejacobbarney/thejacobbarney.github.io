"""Light assist for human-managed teams. usage: python src/assist.py [phase]
Suggestions only: lineup alerts (injured/bye/empty starters, clearly better bench option) and up to
2 waiver ideas that pass the same drop protections as the bots. No trades. Nothing auto-executes.
Isolation: reads only the shared snapshot; never reads or writes bot folders or shared/proposals,
so bots can't see these suggestions and vice versa. Team 5's output stays in my_team/."""
import json, sys, datetime
from common import ROOT, cfg
from personas import PERSONAS
from engine import value, week_score, protected, needed_gain, lineup, OUT_THIS_WEEK
phase = sys.argv[1] if len(sys.argv) > 1 else "tuesday"
c = cfg()
snap = json.loads((ROOT/"shared/snapshot.json").read_text()); wk = snap["week"]
BIG_GAP = 3.0   # only suggest a start/sit swap if the bench player is this much better
MAX_PICKUPS = 2
for tid, a in c.get("assist_teams", {}).items():
    team = snap["teams"][tid]; k = PERSONAS[a["persona"]]; roster = team["roster"]; lines = []
    roster = [dict(p) for p in roster]
    if not any(p["slot"] == "IR" for p in roster):
        for p in roster:
            if p["inj"] == "INJURY_RESERVE":
                lines.append(f"- [ ] Move {p['name']} to IR (open IR slot frees a bench spot)"); p["slot"] = "IR"; break
    lu, used = lineup(roster, k)
    for p in roster:
        if p["slot"] not in ("BE", "IR", "", None) and str(p["inj"]) in OUT_THIS_WEEK:
            lines.append(f"- [ ] **Alert:** {p['name']} is starting but listed {p['inj']}")
    best = {pid for pid in used}
    starters = [p for p in roster if p["slot"] not in ("BE", "IR", "", None)]
    for slot, p in lu:
        if p["slot"] == "BE":
            worst = min((s for s in starters if s["id"] not in best and (s["pos"] == p["pos"] or slot == "RB/WR/TE")),
                        key=lambda s: week_score(s, k), default=None)
            if worst and week_score(p, k) - week_score(worst, k) >= BIG_GAP:
                lines.append(f"- [ ] Consider starting {p['name']} over {worst['name']} (+{week_score(p,k)-week_score(worst,k):.1f} proj)")
    if phase in ("tuesday", "wednesday"):
        n = 0
        for fa in sorted(snap["free_agents"], key=lambda p: -value(p, k)):
            if n >= MAX_PICKUPS: break
            if str(fa["inj"]) in OUT_THIS_WEEK: continue
            cands = [p for p in roster if p["pos"] == fa["pos"] and p["slot"] != "IR" and not protected(p, roster, k)]
            if not cands: continue
            w = min(cands, key=lambda p: value(p, k)); gain = value(fa, k) - value(w, k)
            if gain > needed_gain(w, fa, k):
                lines.append(f"- [ ] Pickup idea: {fa['name']} ({fa['pos']}) for {w['name']} (+{gain:.1f} value)"); n += 1
                roster = [p for p in roster if p["id"] != w["id"]] + [dict(fa, slot="BE")]
    out = ROOT/a["output"]; out.mkdir(parents=True, exist_ok=True)
    body = f"# Assist — {team['name']} — week {wk}, {phase}\nSuggestions only; the manager decides.\n\n" + ("\n".join(lines) or "- Lineup looks fine. No clear pickups.") + "\n"
    (out/f"suggestions_week{wk}.md").write_text(body)
    print(f"{team['name']}: {len(lines)} suggestions -> {a['output']}/")
