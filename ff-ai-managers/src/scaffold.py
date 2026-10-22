"""Create one folder per bot team (persona/rules/memory/log) plus an isolated my_team folder."""
import json
from common import ROOT, cfg, league, slug
from personas import PERSONAS
c, L = cfg(), league()
g = c["guardrails"]
RULES = f"""# Fixed rules (announced to the league)
- Waiver claims only, respecting rolling priority. Max {g['max_waiver_claims_per_week']} claims/week.
- Max {g['max_trade_proposals_per_week']} trade proposals/week. Bot-to-bot trades capped at {g['max_bot_to_bot_trades_per_season']}/season.
- Lineup and IR moves are set by the bots automatically. Waiver claims and trade proposals are not executed until the commissioner approves them; trades with the commissioner's own team also go through normal league review.
- Protected from drops: top-5 roster assets by rest-of-season value, players 60%+ rostered league-wide, and injured (Q/D/O) players 40%+ rostered. Upgrades must beat the dropped player by 3 pts or 25%, whichever is larger.
- No dropping a top-{g['protect_top_n']} roster asset without a logged reason.
- All moves are made as the team's own manager (its own ESPN manager account), never with commissioner/League Manager tools. Waiver claims follow normal priority; lineup and IR changes are made the same way any manager would.
- No two bots may claim the same player in a week; bots pick in waiver-priority order.
- A Questionable starter is only removed from the lineup if ESPN projects him for 0 points that week.
- A team may make several waiver claims and add/drops at the same time. The 30-minute block applies only between different teams: no bot may make a free-agent add/drop within 30 minutes of another bot team's add/drop. Waiver claims and lineup/IR moves are exempt.
- Every move logged with a one-line reason. Pause switch: config/league.json "paused".
"""
for tid, b in c["bot_teams"].items():
    t = L.get_team_data(int(tid)); p = PERSONAS[b["persona"]]
    d = ROOT/"teams"/f"{tid}_{slug(t.team_name)}"; d.mkdir(parents=True, exist_ok=True)
    (d/"persona.md").write_text(f"# {t.team_name} — {p['title']}\n\n{p['desc']}\n\nKnobs: {json.dumps({k:v for k,v in p.items() if k not in ('title','desc')})}\n")
    (d/"rules.md").write_text(RULES)
    if not (d/"memory.md").exists(): (d/"memory.md").write_text(f"# Memory — {t.team_name}\n\n## Season notes\n")
    (d/"log.jsonl").touch()
    print("scaffolded", d.name)
m = ROOT/"my_team"; (m/"notes.md").touch()
print("my_team/ is separate; bots never read it.")
