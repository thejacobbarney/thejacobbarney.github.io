"""Write moves to ESPN via its fantasy transactions API (same endpoint ESPN's site uses; unofficial).
Uses the commissioner cookies from .env. Lineup/IR/free-agent moves run as League Manager;
waiver claims run as the team owner so they go through normal waiver priority."""
import os, time, datetime, requests
from common import load_env, cfg, league
class Cooldown(Exception): pass
class Paused(Exception): pass
def assert_not_paused():
    """Every ESPN write funnels through _post, so the kill switch is enforced here, not per script."""
    if cfg().get("paused", True): raise Paused('config/league.json has "paused": true; refusing to write to ESPN')
def last_bot_add_drop(exclude_team=None):
    """Most recent add/drop by a bot team OTHER than exclude_team, from ESPN's activity feed
    (catches moves made outside this code too). The acting team's own moves never block it."""
    bots = {int(t) for t in cfg()["bot_teams"]} - ({int(exclude_team)} if exclude_team is not None else set())
    for a in league().recent_activity(size=25):
        if any(x[0].team_id in bots and x[1] in ("FA ADDED", "WAIVER ADDED", "DROPPED") for x in a.actions):
            return a.date / 1000
    return 0
def check_cooldown(team_id=None):
    mins = cfg()["guardrails"].get("add_drop_cooldown_minutes", 0)
    if not mins: return
    wait = last_bot_add_drop(team_id) + mins*60 - time.time()
    if wait > 0:
        from zoneinfo import ZoneInfo
        nxt = datetime.datetime.fromtimestamp(time.time() + wait, ZoneInfo("America/Phoenix")).strftime("%-I:%M %p")
        raise Cooldown(f"add/drop cooldown: a different bot team made an add/drop under {mins} min ago; next allowed at {nxt}")
SLOT = {"QB": 0, "RB": 2, "WR": 4, "TE": 6, "RB/WR/TE": 23, "D/ST": 16, "K": 17, "BE": 20, "IR": 21}
def _post(team_id, typ, items, week, lm=True):
    assert_not_paused()
    load_env()
    url = f"https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/{os.environ.get('SEASON',2026)}/segments/0/leagues/{os.environ['LEAGUE_ID']}/transactions/"
    body = {"isLeagueManager": lm, "isActingAsTeamOwner": not lm, "teamId": int(team_id), "type": typ, "memberId": os.environ["SWID"],
            "scoringPeriodId": week, "executionType": "EXECUTE", "bidAmount": 0, "items": items}
    r = requests.post(url, json=body, cookies={"espn_s2": os.environ["ESPN_S2"], "SWID": os.environ["SWID"]},
                      headers={"Content-Type": "application/json", "x-fantasy-source": "kona", "x-fantasy-platform": "kona-PROD"}, timeout=20)
    j = r.json() if "json" in r.headers.get("content-type", "") else {"raw": r.text[:300]}
    return r.status_code, j.get("status"), j.get("messages") or j.get("details") or j.get("raw")
def lineup(team_id, week, moves):  # moves: [(playerId, from_slot_name, to_slot_name)]
    return _post(team_id, "ROSTER", [{"playerId": p, "type": "LINEUP", "fromLineupSlotId": SLOT[f], "toLineupSlotId": SLOT[t]} for p, f, t in moves], week)
def free_agent(team_id, week, add_id, drop_id):
    assert_not_paused()
    check_cooldown(team_id)   # 30-min spacing between add/drops by DIFFERENT bot teams; same team may chain moves
    return _post(team_id, "FREEAGENT", [{"playerId": add_id, "type": "ADD", "toTeamId": int(team_id)}, {"playerId": drop_id, "type": "DROP", "fromTeamId": int(team_id)}], week)
def waiver_claim(team_id, week, add_id, drop_id):
    return _post(team_id, "WAIVER", [{"playerId": add_id, "type": "ADD", "toTeamId": int(team_id)}, {"playerId": drop_id, "type": "DROP", "fromTeamId": int(team_id)}], week, lm=False)
