"""Snapshot league state into shared/snapshot.json (all bots read this; contains no my_team notes)."""
import json, datetime
from common import ROOT, league
L = league()
def P(p): return {"id": p.playerId, "name": p.name, "pos": p.position, "team": p.proTeam,
    "slot": getattr(p, "lineupSlot", None), "proj": round(getattr(p, "projected_avg_points", 0) or 0, 2),
    "avg": round(getattr(p, "avg_points", 0) or 0, 2), "total": round(p.total_points or 0, 1),
    "inj": p.injuryStatus if isinstance(p.injuryStatus,str) else "ACTIVE", "own": round(getattr(p, "percent_owned", 0) or 0, 1),
    "week_proj": WEEK.get(p.playerId, (None,))[0], "bye": WEEK.get(p.playerId, (None, "False"))[1] == "True"}
wk = L.current_week
# This-week projections (0 on bye) from box scores; used for start/sit, not drops
WEEK = {}
for b in L.box_scores(wk):
    for lu in (b.home_lineup, b.away_lineup):
        for p in lu: WEEK[p.playerId] = (round(p.projected_points or 0, 2), str(getattr(p, "on_bye_week", False) or p.pro_opponent in ("None", None, "")))
snap = {"pulled": datetime.datetime.now().isoformat(timespec="minutes"), "week": wk,
  "teams": {t.team_id: {"name": t.team_name, "w": t.wins, "l": t.losses, "pf": round(t.points_for, 1),
            "waiver_rank": getattr(t, "waiver_rank", None), "roster": [P(p) for p in t.roster]} for t in L.teams},
  "matchups": [{"home": b.home_team.team_id, "away": b.away_team.team_id if b.away_team else None} for b in L.box_scores(wk)],
  "free_agents": [P(p) for p in L.free_agents(size=150)]}
(ROOT/"shared/snapshot.json").write_text(json.dumps(snap, indent=1))
print(f"week {wk}: {len(snap['teams'])} teams, {len(snap['free_agents'])} FAs")
