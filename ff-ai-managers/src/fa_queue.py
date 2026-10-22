"""Run commissioner-approved free-agent adds one at a time, respecting the league-wide add/drop cooldown.
usage: python src/fa_queue.py <week> <proposal ids in order>   (authorized by commissioner 2026-10-14)
After an add that removes a starter, fills that team's empty slot only. Logs to shared/fa_queue.log."""
import json, time, datetime, subprocess, sys
import espn_write as W
from common import ROOT
WK, ORDER = sys.argv[1], sys.argv[2:]
PF = ROOT/f"shared/proposals/week{WK}.json"; LOG = ROOT/"shared/fa_queue.log"
def log(m):
    with open(LOG, "a") as f: f.write(f"{datetime.datetime.now().astimezone().strftime('%a %I:%M %p')} {m}\n")
for pid in ORDER:
    P = json.loads(PF.read_text()); x = next(p for p in P if p["id"] == pid)
    if x["status"] != "approved" or x.get("executed"): log(f"{pid} skipped ({x['status']})"); continue
    while True:
        try: r = W.free_agent(x["team_id"], x["week"], x["add_id"], x["drop_id"]); break
        except W.Cooldown as e: log(f"{pid} waiting: {e}"); time.sleep(120)
    ok = r[1] == "EXECUTED"
    x["executed"] = datetime.datetime.now().isoformat(timespec="minutes") if ok else None; x["submit_result"] = list(r)
    PF.write_text(json.dumps(P, indent=1))
    tdir = next(d for d in (ROOT/"teams").iterdir() if d.name.startswith(x["team_id"] + "_"))
    with open(tdir/"log.jsonl", "a") as f:
        f.write(json.dumps({"type": "FREEAGENT", "week": x["week"], "id": pid, "ts": x["executed"], "detail": f"add {x['add']}, drop {x['drop']}", "result": list(r), "via": "ESPN API (LM), commissioner-authorized"})+"\n")
    log(f"{pid} {x['team']}: add {x['add']}, drop {x['drop']} -> {r}")
    if ok:
        out = subprocess.run([sys.executable, str(ROOT/"src/lineup_check.py"), "--apply", "--team", x["team_id"]], capture_output=True, text=True, cwd=ROOT)
        log(f"  lineup fill {x['team']}: " + " | ".join(l.strip() for l in out.stdout.splitlines() if " in at " in l or "complete" in l or "NO BENCH" in l))
log("queue done")
