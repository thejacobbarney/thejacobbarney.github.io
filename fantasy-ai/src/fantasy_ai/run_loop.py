"""Weekly run loop.

Flow per phase:
  1. `refresh`            pull ESPN data into data/snapshot.json
  2. `prepare <phase>`    write one context bundle per agent into out/week-NN/<slug>/<phase>.md
  3. An agent (a Claude Code subagent, or any LLM) reads its bundle and writes
     out/week-NN/moves/<slug>.<phase>.json  (schema in the bundle)
  4. `collect`            validate every moves file with the guardrails, write the decision log,
                          render out/week-NN/move_sheet.md
  5. `summary`            weekly summary for the commissioner
"""
import json

from . import availability, decision_log, guardrails, move_sheet
from .config import dead_teams, league_cfg, rules_cfg
from .espn_client import load_snapshot
from .paths import AGENTS, week_dir

PHASES = {
    "tuesday": {
        "title": "Tuesday night: read data, refresh strategy notes",
        "task": (
            "Review last week's results and this week's matchups. Update memory.md (season plan, roster "
            "notes, trade notes) by returning the full new text in `memory_update`. Propose no moves "
            "unless there is an injury emergency (then use IR/lineup moves only)."
        ),
    },
    "wednesday": {
        "title": "Wednesday: waiver claims (and trade proposals)",
        "task": (
            "Decide this week's waiver claims (respect waiver priority and FAAB) and any trade "
            "proposals. Waiver claims only, never commissioner add/drops."
        ),
    },
    "thursday": {
        "title": "Thursday morning: lineup check before kickoff",
        "task": "Set the optimal lineup for Thursday's game and the rest of the week. Fix IR and empty slots.",
    },
    "sunday": {
        "title": "Sunday morning: inactives scan (about 90 minutes before early games)",
        "task": (
            "Check for inactives, late scratches and bye-week conflicts. Swap any inactive or "
            "out starter for the best available active bench player. Lineup and IR moves only."
        ),
    },
}

SCHEMA = """```json
{
  "team_id": 0,
  "week": 0,
  "phase": "wednesday",
  "moves": [
    {"type": "waiver_claim", "add": {"id": 0, "name": ""}, "drop": {"id": 0, "name": ""}, "faab_bid": 0,
     "gap_check": {"cause": "bye | injury | injury_risk", "evidence": "required if the drop has a projection gap"},
     "reason": "one line, >= 15 chars", "top_asset_drop_reason": "only if dropping a top-5 asset"},
    {"type": "lineup", "changes": [{"player": {"id": 0, "name": ""}, "from_slot": "BE", "to_slot": "RB"}],
     "reason": ""},
    {"type": "ir_move", "move_to_ir": {"id": 0, "name": ""}, "drop_or_swap_in": null, "reason": ""},
    {"type": "trade_proposal", "to_team_id": 0, "give": [{"id": 0, "name": ""}],
     "get": [{"id": 0, "name": ""}], "reason": ""}
  ],
  "memory_update": "optional full replacement text for memory.md (Tuesday phase)"
}
```"""


def _read(path):
    return path.read_text() if path.exists() else ""


def _slim_player(p, week=None):
    keys = ("id", "name", "position", "pro_team", "injury_status", "lineup_slot", "week_projected",
            "bye_week", "projected_total_points", "projected_avg_points", "total_points", "avg_points",
            "percent_owned")
    out = {k: p.get(k) for k in keys}
    if week is not None:
        out.update(availability.annotate(p, week))
    return out


def build_bundle(phase, team_id, entry, snapshot, rules, week):
    slug = entry["slug"]
    adir = AGENTS / slug
    me = next(t for t in snapshot["teams"] if t["team_id"] == team_id)
    others = [{"team_id": t["team_id"], "name": t["name"], "record": f"{t['wins']}-{t['losses']}",
               "owners": t["owners"], "roster": [_slim_player(p, week) for p in t["roster"]]}
              for t in snapshot["teams"] if t["team_id"] != team_id]
    matchup = next((m for m in snapshot["matchups"]
                    if team_id in (m.get("home_team_id"), m.get("away_team_id"))), None)
    mine = {k: v for k, v in me.items() if k != "roster"}
    mine["roster"] = [_slim_player(p, week) for p in me["roster"]]
    top = sorted(snapshot["free_agents"],
                 key=lambda p: p.get("projected_total_points") or 0, reverse=True)[:60]
    info = PHASES[phase]
    return f"""# {info['title']}: {slug}, week {week}

## Your task
{info['task']}

You manage team_id {team_id} only. The guardrails in config/rules.yaml are enforced by code and
anything that violates them is rejected.

## Global guardrails
```json
{json.dumps(rules, indent=2)}
```

## Your rules
{_read(adir / 'rules.md')}

## Your persona
{_read(adir / 'persona.md')}

## Your memory
{_read(adir / 'memory.md')}

## League settings
```json
{json.dumps(snapshot['settings'], indent=2)}
```

## Your team (week {week})
```json
{json.dumps(mine, indent=2)}
```

## Your matchup
```json
{json.dumps(matchup, indent=2)}
```

## Best free agents (by projected points)
```json
{json.dumps([_slim_player(p, week) for p in top], indent=2)}
```

## Other teams (for trades)
```json
{json.dumps(others, indent=2)}
```

## Recent league activity
{chr(10).join('- ' + a for a in snapshot.get('recent_activity', [])) or '(none)'}

## Before you propose a drop
If a player you want to drop has `gap_cause` set, their week projection is missing or zero. Find out why:
`bye` is NOT a reason to drop (judge on per-game / rest of season), `injury` and `injury_risk` are real
concerns, `unexplained` means stop and find the cause. Put your finding in the claim's `gap_check`.

## Output
Write ONLY a JSON file at out/week-{week:02d}/moves/{slug}.{phase}.json matching this schema.
Use `"moves": []` if there is nothing worth doing. Every move needs a one-line reason.
{SCHEMA}
"""


def prepare(phase):
    if phase not in PHASES:
        raise SystemExit(f"phase must be one of {sorted(PHASES)}")
    cfg, rules, snap = league_cfg(), rules_cfg(), load_snapshot()
    week = snap["current_week"]
    wd = week_dir(week)
    (wd / "moves").mkdir(exist_ok=True)
    written = []
    for tid, entry in dead_teams(cfg).items():
        folder = wd / entry["slug"]
        folder.mkdir(exist_ok=True)
        path = folder / f"{phase}.md"
        path.write_text(build_bundle(phase, tid, entry, snap, rules, week))
        written.append(path)
    return week, written


def collect():
    """Validate all moves files for the current week, log decisions, render the move sheet."""
    cfg, rules, snap = league_cfg(), rules_cfg(), load_snapshot()
    week = snap["current_week"]
    wd = week_dir(week)
    bots = dead_teams(cfg)
    state = guardrails.new_state()
    results = {tid: {"slug": e["slug"], "approved": [], "rejected": []} for tid, e in bots.items()}

    for tid, entry in sorted(bots.items()):
        slug = entry["slug"]
        for path in sorted((wd / "moves").glob(f"{slug}.*.json")):
            phase = path.stem.split(".", 1)[1]
            try:
                doc = json.loads(path.read_text())
                doc["team_id"] = tid  # an agent can never act for another team
            except json.JSONDecodeError as e:
                results[tid]["rejected"].append({"move": {"type": "file"}, "violations": [f"{path.name}: bad JSON ({e})"]})
                continue
            ok, bad = guardrails.validate(doc, snap, rules, cfg, state)
            for m in ok:
                decision_log.append(slug, tid, week, phase, m, "approved")
            for x in bad:
                decision_log.append(slug, tid, week, phase, x["move"], "rejected", x["violations"])
            results[tid]["approved"] += ok
            results[tid]["rejected"] += bad
            mem = doc.get("memory_update")
            if mem and not rules.get("paused"):
                (AGENTS / slug / "memory.md").write_text(mem.rstrip() + "\n")

    teams_by_id = {t["team_id"]: t for t in snap["teams"]}
    sheet = move_sheet.render(week, teams_by_id, results)
    (wd / "move_sheet.md").write_text(sheet)
    (wd / "move_sheet.json").write_text(json.dumps(
        {str(k): v for k, v in results.items()}, indent=2, default=str))
    return week, results, wd / "move_sheet.md"


def summary():
    cfg, snap = league_cfg(), load_snapshot()
    week = snap["current_week"]
    teams = {t["team_id"]: t for t in snap["teams"]}
    lines = [f"# Weekly summary: week {week}", ""]
    for tid, entry in sorted(dead_teams(cfg).items()):
        t = teams.get(tid, {})
        latest = {}
        for e in decision_log.load(entry["slug"]):
            if e["week"] == week:
                latest[e["id"]] = e
        lines.append(f"## {t.get('name', tid)} ({entry['persona']}), {t.get('wins')}-{t.get('losses')}, "
                     f"FAAB left {t.get('faab_remaining')}")
        if not latest:
            lines.append("- no moves this week")
        for e in latest.values():
            lines.append(f"- [{e['status']}] {e['type']}: {e['reason']}"
                         + (f" (blocked: {'; '.join(e['violations'])})" if e["violations"] else ""))
        lines.append("")
    path = week_dir(week) / "weekly_summary.md"
    path.write_text("\n".join(lines))
    return path
