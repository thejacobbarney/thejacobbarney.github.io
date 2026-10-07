"""Synthetic 4-team league so everything can be tested without ESPN."""


def player(pid, name, pos, proj, slot="BE", injury="ACTIVE"):
    return {"id": pid, "name": name, "position": pos, "pro_team": "XXX", "injury_status": injury,
            "lineup_slot": slot, "pos_rank": 1, "percent_owned": 50.0, "total_points": proj / 2,
            "projected_total_points": proj, "avg_points": proj / 17, "projected_avg_points": proj / 17,
            "eligible_slots": [pos, "BE"], "stats_weeks": {}}


def snapshot():
    def team(tid, name, base):
        roster = [player(base + i, f"P{base + i}", pos, 300 - i * 40, "BE")
                  for i, pos in enumerate(["QB", "RB", "WR", "TE", "RB", "WR", "WR"])]
        return {"team_id": tid, "abbrev": f"T{tid}", "name": name, "owners": ["Owner"], "wins": 3, "losses": 2,
                "ties": 0, "points_for": 500, "points_against": 480, "standing": tid, "waiver_rank": tid,
                "faab_spent": 10, "faab_remaining": 90, "acquisitions": 1, "drops": 1, "trades": 0,
                "streak": "WIN 1", "roster": roster}
    return {
        "fetched_at": "2026-10-07T12:00:00+00:00", "league_id": 1, "season": 2026, "current_week": 5,
        "settings": {"faab": True, "acquisition_budget": 100, "minimum_bid": 0, "acquisition_limit": None,
                     "waiver_process_days": ["WED"], "trade_deadline": 0, "veto_votes_required": 0,
                     "reg_season_count": 14, "playoff_team_count": 6, "position_slot_counts": {},
                     "scoring_format": [], "trade_revision_hours": 24, "matchup_acquisition_limit": None,
                     "waiver_process_hour": 3},
        "teams": [team(1, "Me", 100), team(2, "Bot A", 200), team(3, "Bot B", 300), team(4, "Bot C", 400)],
        "matchups": [{"week": 5, "home_team_id": 1, "away_team_id": 2, "home_score": 0, "away_score": 0,
                      "home_projected": 100, "away_projected": 95},
                     {"week": 5, "home_team_id": 3, "away_team_id": 4, "home_score": 0, "away_score": 0,
                      "home_projected": 90, "away_projected": 99}],
        "free_agents": [player(900, "Waiver Guy", "WR", 120), player(901, "Streamer QB", "QB", 150)],
        "recent_activity": ["Bot A added Waiver Guy"],
    }


CFG = {"league_id": 1, "season": 2026, "my_team_id": 1,
       "dead_teams": {2: {"slug": "team02-quant", "persona": "quant"},
                      3: {"slug": "team03-trade-shark", "persona": "trade_shark"},
                      4: {"slug": "team04-safe-floor", "persona": "safe_floor"}}}
