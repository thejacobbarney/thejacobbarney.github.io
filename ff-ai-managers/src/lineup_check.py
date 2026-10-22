"""Check bot lineups for this week: any starter on bye, OUT/IR/Doubtful/suspended, projected 0, or an empty slot
gets replaced by the best eligible bench player (ESPN week projection). Players whose game started are locked.
usage: python src/lineup_check.py [--apply]"""
import sys, json
from common import league, cfg
import espn_write as W
APPLY = "--apply" in sys.argv
if APPLY and cfg().get("paused", True):
    sys.exit('PAUSED: config/league.json has "paused": true. Dry run only (omit --apply).')
ONLY = sys.argv[sys.argv.index("--team")+1] if "--team" in sys.argv else None
L = league(); wk = L.current_week; c = cfg()
BAD = {"OUT", "INJURY_RESERVE", "DOUBTFUL", "SUSPENSION"}
NEED = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 2, "D/ST": 1, "K": 1}
def locked(p): return (p.game_played or 0) > 0 and not p.on_bye_week
# Questionable is NOT in BAD: a Questionable starter is only removed when projected 0 (caught by the proj check).
def dead(p): return p.on_bye_week or str(p.injuryStatus) in BAD or (p.projected_points or 0) <= 0
report = {}
for b in L.box_scores(wk):
    for team, lu in ((b.home_team, b.home_lineup), (b.away_team, b.away_lineup)):
        if not team or str(team.team_id) not in c["bot_teams"] or (ONLY and str(team.team_id) != ONLY): continue
        starters = [p for p in lu if p.slot_position not in ("BE", "IR")]
        bench = [p for p in lu if p.slot_position == "BE" and not locked(p) and not dead(p)]
        moves, notes = [], []
        filled = {s: sum(1 for p in starters if p.slot_position == s) for s in NEED}
        holes = [(p.slot_position, p) for p in starters if dead(p) and not locked(p)]
        holes += [(s, None) for s, n in NEED.items() for _ in range(n - filled.get(s, 0))]
        for slot, out in holes:
            cands = sorted([p for p in bench if slot in p.eligibleSlots], key=lambda p: -(p.projected_points or 0))
            if not cands:
                notes.append(f"NO BENCH OPTION for {slot}" + (f" ({out.name}: {'BYE' if out.on_bye_week else out.injuryStatus}, proj {out.projected_points})" if out else " (empty)")); continue
            sub = cands[0]; bench.remove(sub)
            if out: moves.append((out.playerId, slot, "BE"))
            moves.append((sub.playerId, "BE", slot))
            notes.append(f"{sub.name} ({sub.projected_points:.1f}) in at {slot}" + (f" for {out.name} ({'BYE' if out.on_bye_week else out.injuryStatus}, {out.projected_points or 0:.1f})" if out else " (empty slot)"))
        res = W.lineup(team.team_id, wk, moves)[:2] if (APPLY and moves) else None
        report[team.team_name] = {"changes": notes or ["lineup complete"], "applied": res}
print(json.dumps(report, indent=1))
