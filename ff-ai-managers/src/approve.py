"""Commissioner approval. Nothing is executed or put on the move sheet until approved here.
  python src/approve.py                 list pending
  python src/approve.py approve w5-3 w5-4   |  approve all  |  approve team 3
  python src/approve.py reject w5-7 "reason"
Trades involving the commissioner's own team still need league review after approval."""
import json, sys, datetime
from common import ROOT, cfg
snap = json.loads((ROOT/"shared/snapshot.json").read_text()); wk = snap["week"]
PROP = ROOT/f"shared/proposals/week{wk}.json"
props = json.loads(PROP.read_text()) if PROP.exists() else []
def desc(p):
    return {"WAIVER": f"claim {p.get('add')}, drop {p.get('drop')}", "START": f"start {p.get('player')} at {p.get('slot')}",
            "BENCH": f"bench {p.get('player')}", "IR": f"{p.get('player')} to IR",
            "TRADE_IDEA": f"trade idea ({p.get('style')})"}.get(p["type"], p["type"])
def log(p, status, note=""):
    d = next((ROOT/"teams").glob(f"{p['team_id']}_*"))
    with open(d/"log.jsonl", "a") as f:
        f.write(json.dumps(dict(p, status=status, decided=datetime.datetime.now().isoformat(timespec="minutes"), note=note))+"\n")
args = sys.argv[1:]
if not args:
    pend = [p for p in props if p["status"] == "pending"]
    for p in pend: print(f"{p['id']:8} {p['team'][:22]:22} {desc(p):50} — {p['reason']}")
    print(f"\n{len(pend)} pending. approve <ids|all|team N> / reject <ids> \"reason\""); sys.exit()
action, rest = args[0], args[1:]
note = rest.pop() if action == "reject" and len(rest) > 1 and not rest[-1].startswith("w") else ""
if rest[:1] == ["all"]: sel = [p for p in props if p["status"] == "pending"]
elif rest[:1] == ["team"]: sel = [p for p in props if p["status"] == "pending" and p["team_id"] == rest[1]]
else: sel = [p for p in props if p["id"] in rest and p["status"] == "pending"]
status = {"approve": "approved", "reject": "rejected"}[action]
for p in sel:
    p["status"] = status; log(p, status, note)
    print(f"{status}: {p['id']} {p['team']} — {desc(p)}" + (" (still needs league review)" if p.get("needs_league_review") else ""))
PROP.write_text(json.dumps(props, indent=1))
