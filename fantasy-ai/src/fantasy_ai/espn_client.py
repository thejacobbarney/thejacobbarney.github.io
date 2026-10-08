"""Pull league data from ESPN with the community espn-api library.

Credentials come only from environment variables:
    ESPN_S2    the espn_s2 cookie
    ESPN_SWID  the SWID cookie (including braces)
They expire periodically; when ESPNAccessDenied appears, refresh them from your browser.
"""
import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import unquote

from .paths import DATA, SNAPSHOT

FA_POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"]


class MissingCredentials(RuntimeError):
    pass


def _creds():
    s2, swid = os.environ.get("ESPN_S2"), os.environ.get("ESPN_SWID")
    if not s2 or not swid:
        raise MissingCredentials(
            "Set ESPN_S2 and ESPN_SWID in your environment (do not put them in files)."
        )
    return s2.strip(), swid.strip()


def get_league(league_id, season):
    from espn_api.football import League
    from espn_api.requests.espn_requests import ESPNAccessDenied

    s2, swid = _creds()
    # The browser cookie is usually percent-encoded; try as-is, then decoded.
    last = None
    for candidate in dict.fromkeys([s2, unquote(s2)]):
        try:
            return League(league_id=league_id, year=season, espn_s2=candidate, swid=swid)
        except ESPNAccessDenied as e:
            last = e
    raise last


def _pro_byes(league):
    """{pro team abbrev: bye week}, from ESPN's pro schedule (a week with no game is the bye)."""
    from espn_api.football.constant import PRO_TEAM_MAP

    byes = {}
    try:
        for team_id, games in league._get_all_pro_schedule().items():
            if team_id == 0:
                continue
            missing = [w for w in range(1, 19) if not games.get(str(w))]
            if len(missing) == 1:
                byes[PRO_TEAM_MAP[team_id]] = missing[0]
    except Exception:
        pass
    return byes


def _week_projection(p, week):
    if hasattr(p, "projected_points"):  # BoxPlayer (free agents)
        return p.projected_points
    return ((getattr(p, "stats", {}) or {}).get(week) or {}).get("projected_points")


def _player(p, week=None, byes=None):
    g = lambda name, default=None: getattr(p, name, default)
    stats = g("stats", {}) or {}
    return {
        "week_projected": _week_projection(p, week),
        "bye_week": (byes or {}).get(g("proTeam")),
        "id": g("playerId"),
        "name": g("name"),
        "position": g("position"),
        "pro_team": g("proTeam"),
        "injury_status": g("injuryStatus"),
        "lineup_slot": g("lineupSlot", ""),
        "pos_rank": g("posRank"),
        "percent_owned": g("percent_owned"),
        "total_points": g("total_points", 0) or 0,
        "projected_total_points": g("projected_total_points", 0) or 0,
        "avg_points": g("avg_points", 0) or 0,
        "projected_avg_points": g("projected_avg_points", 0) or 0,
        "eligible_slots": g("eligibleSlots", []),
        "stats_weeks": {str(k): v.get("points") for k, v in stats.items() if k != 0},
    }


def build_snapshot(league, league_id, season, fa_per_position=40):
    s = league.settings
    week = league.current_week
    byes = _pro_byes(league)
    budget = getattr(s, "acquisition_budget", 0) or 0

    teams = []
    for t in league.teams:
        spent = getattr(t, "acquisition_budget_spent", 0) or 0
        teams.append(
            {
                "team_id": t.team_id,
                "abbrev": t.team_abbrev,
                "name": t.team_name,
                "owners": [
                    f"{o.get('firstName', '')} {o.get('lastName', '')}".strip()
                    for o in (t.owners or [])
                ],
                "wins": t.wins,
                "losses": t.losses,
                "ties": t.ties,
                "points_for": t.points_for,
                "points_against": t.points_against,
                "standing": t.standing,
                "waiver_rank": t.waiver_rank,
                "faab_spent": spent,
                "faab_remaining": max(budget - spent, 0) if s.faab else None,
                "acquisitions": t.acquisitions,
                "drops": t.drops,
                "trades": t.trades,
                "streak": f"{t.streak_type} {t.streak_length}",
                "roster": [_player(p, week, byes) for p in t.roster],
            }
        )

    matchups = []
    try:
        for b in league.box_scores(week):
            matchups.append(
                {
                    "week": week,
                    "home_team_id": getattr(b.home_team, "team_id", None),
                    "away_team_id": getattr(b.away_team, "team_id", None),
                    "home_score": b.home_score,
                    "away_score": b.away_score,
                    "home_projected": getattr(b, "home_projected", None),
                    "away_projected": getattr(b, "away_projected", None),
                }
            )
    except Exception as e:  # box scores can fail in the preseason
        matchups = [{"error": str(e)}]

    free_agents, seen = [], set()
    for pos in FA_POSITIONS:
        try:
            for p in league.free_agents(week=week, size=fa_per_position, position=pos):
                if p.playerId not in seen:
                    seen.add(p.playerId)
                    free_agents.append(_player(p, week, byes))
        except Exception as e:
            free_agents.append({"error": f"{pos}: {e}"})

    activity = []
    try:
        activity = [str(a) for a in league.recent_activity(size=25)]
    except Exception:
        pass

    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "league_id": league_id,
        "season": season,
        "current_week": week,
        "settings": {
            "faab": s.faab,
            "acquisition_budget": budget,
            "minimum_bid": getattr(s, "minimum_bid", 0),
            "acquisition_limit": getattr(s, "acquisition_limit", None),
            "matchup_acquisition_limit": getattr(s, "matchup_acquisition_limit", None),
            "waiver_process_days": getattr(s, "waiver_process_days", []),
            "waiver_process_hour": getattr(s, "waiver_process_hour", None),
            "trade_deadline": s.trade_deadline,
            "trade_revision_hours": getattr(s, "trade_revision_hours", None),
            "veto_votes_required": s.veto_votes_required,
            "reg_season_count": s.reg_season_count,
            "playoff_team_count": s.playoff_team_count,
            "position_slot_counts": getattr(s, "position_slot_counts", {}),
            "scoring_format": [
                {"abbr": x.get("abbr"), "points": x.get("points")}
                for x in getattr(s, "scoring_format", [])
            ],
        },
        "pro_byes": byes,
        "teams": teams,
        "matchups": matchups,
        "free_agents": free_agents,
        "recent_activity": activity,
    }


def refresh(league_id, season):
    league = get_league(league_id, season)
    snap = build_snapshot(league, league_id, season)
    DATA.mkdir(exist_ok=True)
    tmp = SNAPSHOT.with_suffix(".tmp")
    tmp.write_text(json.dumps(snap, indent=2, default=str))
    tmp.replace(SNAPSHOT)
    return snap


def load_snapshot():
    if not SNAPSHOT.exists():
        raise FileNotFoundError("No snapshot yet. Run: python -m fantasy_ai refresh")
    return json.loads(SNAPSHOT.read_text())


def snapshot_age_hours(snap):
    t = datetime.fromisoformat(snap["fetched_at"])
    return (datetime.now(timezone.utc) - t).total_seconds() / 3600
