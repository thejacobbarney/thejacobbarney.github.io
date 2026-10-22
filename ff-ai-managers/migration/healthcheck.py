"""Read-only checks for a new host. Makes no changes to the league.
Usage: .venv/bin/python migration/healthcheck.py"""
import os, sys, json, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
ok = True
def check(name, fn):
    global ok
    try:
        r = fn(); print(f"[OK]   {name}" + (f": {r}" if r else ""))
    except Exception as e:
        ok = False; print(f"[FAIL] {name}: {e}")

from common import load_env, cfg
check(".env present and private", lambda: (ROOT/".env").exists() and oct((ROOT/".env").stat().st_mode)[-3:])
load_env()
check("env vars set", lambda: ",".join(k for k in ("LEAGUE_ID","SEASON","SWID","ESPN_S2") if os.environ.get(k)) or (_ for _ in ()).throw(Exception("missing")))
c = cfg()
check("config/league.json", lambda: f"paused={c.get('paused')} bots={list(c['bot_teams'])} mode={c.get('execution',{}).get('mode')}")
def league_read():
    from common import league
    L = league()
    return f"{L.settings.name} week {L.current_week}, {len(L.teams)} teams"
check("ESPN read with cookies (league data)", league_read)
def private_read():
    import requests
    E = os.environ
    u = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{E['SEASON']}/segments/0/leagues/{E['LEAGUE_ID']}"
    r = requests.get(u, params={"view": "mTransactions2"}, cookies={"espn_s2": E["ESPN_S2"], "SWID": E["SWID"]}, timeout=30)
    if r.status_code != 200: raise Exception(f"HTTP {r.status_code} - cookies likely expired; refresh SWID/ESPN_S2")
    return f"{len(r.json().get('transactions', []))} recent transactions visible"
check("Commissioner cookie auth (private endpoint)", private_read)
def folders():
    from common import slug
    from common import league
    L = league(); names = {t.team_id: t.team_name for t in L.teams}; miss = []
    for tid in c["bot_teams"]:
        d = ROOT/"teams"/f"{tid}_{slug(names[int(tid)])}"
        if not all((d/f).exists() for f in ("persona.md","rules.md","log.jsonl")): miss.append(str(d.name))
    if miss: raise Exception("missing team files: " + ", ".join(miss))
    return "all bot team folders present"
check("bot team folders", folders)
check("timezone", lambda: f"local now {datetime.datetime.now().astimezone():%Y-%m-%d %H:%M %Z} (schedule assumes America/Phoenix)")
print("\nALL CHECKS PASSED" if ok else "\nSOME CHECKS FAILED - see above")
print("Optional dry run (no writes): .venv/bin/python src/lineup_check.py")
sys.exit(0 if ok else 1)
