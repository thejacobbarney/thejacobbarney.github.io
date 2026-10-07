"""Append-only decision log, one JSONL file per agent: agents/<slug>/decision_log.jsonl.

Every move gets a one-line reason. Entries are deduplicated by a stable id so
`collect` can be re-run safely.
"""
import hashlib
import json
from datetime import datetime, timezone

from .paths import AGENTS


def _path(slug):
    return AGENTS / slug / "decision_log.jsonl"


def entry_id(team_id, week, phase, move):
    blob = json.dumps([team_id, week, phase, move], sort_keys=True, default=str)
    return hashlib.sha1(blob.encode()).hexdigest()[:12]


def load(slug):
    p = _path(slug)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def append(slug, team_id, week, phase, move, status, violations=None):
    """status: approved | rejected | executed | failed. Returns the entry, or None if duplicate."""
    eid = entry_id(team_id, week, phase, move)
    existing = {e["id"]: e for e in load(slug)}
    if eid in existing and existing[eid]["status"] == status:
        return None
    entry = {
        "id": eid,
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "team_id": team_id,
        "week": week,
        "phase": phase,
        "type": move.get("type"),
        "reason": move.get("reason", ""),
        "status": status,
        "violations": violations or [],
        "move": move,
    }
    p = _path(slug)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a") as f:
        f.write(json.dumps(entry, default=str) + "\n")
    return entry


def mark(slug, eid, status, note=""):
    """Record execution of a move (used by the browser-automation phase)."""
    for e in reversed(load(slug)):
        if e["id"] == eid:
            return append_raw(slug, {**e, "status": status, "note": note,
                                     "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    raise KeyError(eid)


def append_raw(slug, entry):
    p = _path(slug)
    with open(p, "a") as f:
        f.write(json.dumps(entry, default=str) + "\n")
    return entry


def approved_trades_between(a, b, slugs_by_team):
    """Count approved/executed trade proposals between teams a and b across both logs."""
    pair, seen = {a, b}, set()
    for tid in (a, b):
        slug = slugs_by_team.get(tid)
        if not slug:
            continue
        latest = {}
        for e in load(slug):
            latest[e["id"]] = e
        for e in latest.values():
            m = e["move"]
            if e["type"] == "trade_proposal" and e["status"] in ("approved", "executed"):
                if {e["team_id"], int(m["to_team_id"])} == pair:
                    seen.add(e["id"])
    return len(seen)
