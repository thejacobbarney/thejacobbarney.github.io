"""Render APPROVED proposals for the current week into a click-through checklist."""
import json
from common import ROOT, cfg, team_creds
snap = json.loads((ROOT/"shared/snapshot.json").read_text()); wk = snap["week"]
PROP = ROOT/f"shared/proposals/week{wk}.json"
props = json.loads(PROP.read_text()) if PROP.exists() else []
ok = [p for p in props if p["status"] == "approved" and not p.get("executed")]
pend = sum(p["status"] == "pending" for p in props)
out = [f"# Move sheet — week {wk} (approved moves)\n",
       f"{len(ok)} approved moves to execute; {pend} still pending approval.\n",
       "Every move is made logged in as that team's own manager account, never with League Manager tools.\n"]
for team in dict.fromkeys(p["team"] for p in ok):
    rows = [p for p in ok if p["team"] == team]; tid = rows[0]["team_id"]
    acct = cfg()["bot_teams"].get(tid, {}).get("espn_account") or "(no manager account set)"
    out.append(f"\n## {team} ({rows[0]['persona']})\nLog in as: {acct}" + ("" if team_creds(tid) else " — cookies missing in .env") + "\n\n")
    for m in rows:
        line = {"WAIVER": f"Claim **{m.get('add')}**, drop {m.get('drop')}", "START": f"Start {m.get('player')} at {m.get('slot')}",
                "BENCH": f"Bench {m.get('player')}", "IR": f"Move {m.get('player')} to IR",
                "TRADE_IDEA": f"Trade idea ({m.get('style')}) — draft offer"}.get(m["type"], m["type"])
        out.append(f"- [ ] `{m['id']}` {line} — {m['reason']}" + (" (auto)" if m.get("auto") else "") + (" — needs league review" if m.get("needs_league_review") else "") + "\n")
p = ROOT/f"move_sheets/week{wk}.md"; p.write_text("".join(out)); print("wrote", p)
