import os, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
def load_env():
    p = ROOT/".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
def league():
    load_env()
    from espn_api.football import League
    return League(league_id=int(os.environ["LEAGUE_ID"]), year=int(os.environ.get("SEASON", 2026)),
                  espn_s2=os.environ["ESPN_S2"], swid=os.environ["SWID"])
def cfg(): return json.loads((ROOT/"config/league.json").read_text())
def slug(name): return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")

def team_creds(tid):
    """Cookies for the ESPN account that manages team `tid`. Never falls back to the commissioner's."""
    load_env()
    s2, sw = os.environ.get(f"ESPN_S2_TEAM_{tid}"), os.environ.get(f"SWID_TEAM_{tid}")
    return (s2, sw) if s2 and sw else None
def team_league(tid):
    """League object authenticated as team `tid`'s own manager (for execution/automation)."""
    cr = team_creds(tid)
    if not cr: raise SystemExit(f"No manager cookies for team {tid}: set ESPN_S2_TEAM_{tid} and SWID_TEAM_{tid} in .env")
    from espn_api.football import League
    return League(league_id=int(os.environ["LEAGUE_ID"]), year=int(os.environ.get("SEASON", 2026)), espn_s2=cr[0], swid=cr[1])
