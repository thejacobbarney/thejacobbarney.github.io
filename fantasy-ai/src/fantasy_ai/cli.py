"""Usage: python -m fantasy_ai <command>

  refresh                      pull ESPN data into data/snapshot.json, print all team ids
  new-agent <team_id> <persona> [slug]
                               scaffold agents/<slug>/ from the template + persona and register it in
                               config/league.yaml
  prepare <phase>              write per-agent context bundles (phase: tuesday|wednesday|thursday|sunday)
  collect                      validate agent moves, update decision logs, write the move sheet
  summary                      write the weekly summary for the commissioner
  status                       show config, snapshot age, and pause state
"""
import re
import sys

import yaml

from . import espn_client, run_loop
from .config import dead_teams, league_cfg, rules_cfg
from .paths import AGENTS, CONFIG, PERSONAS


def _slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def cmd_refresh(_):
    cfg = league_cfg()
    snap = espn_client.refresh(cfg["league_id"], cfg["season"])
    s = snap["settings"]
    print(f"Week {snap['current_week']}, {len(snap['teams'])} teams. "
          f"FAAB={s['faab']} budget={s['acquisition_budget']} trade_deadline={s['trade_deadline']}")
    for t in snap["teams"]:
        print(f"  id {t['team_id']:>2}  {t['name']:<28} {t['wins']}-{t['losses']}  "
              f"owners: {', '.join(t['owners']) or '(none)'}")
    print("\nPut your team id in my_team_id and each dead team in dead_teams in config/league.yaml.")


def cmd_new_agent(args):
    if len(args) < 2:
        raise SystemExit("usage: new-agent <team_id> <persona> [slug]")
    team_id, persona = int(args[0]), args[1]
    pfile = PERSONAS / f"{persona}.md"
    if not pfile.exists():
        raise SystemExit(f"no persona {persona!r}. Available: " + ", ".join(p.stem for p in sorted(PERSONAS.glob('*.md'))))
    snap = None
    try:
        snap = espn_client.load_snapshot()
    except FileNotFoundError:
        pass
    team_name = next((t["name"] for t in (snap or {}).get("teams", []) if t["team_id"] == team_id), f"Team {team_id}")
    slug = args[2] if len(args) > 2 else f"team{team_id:02d}-{persona.replace('_', '-')}"
    dest = AGENTS / slug
    if dest.exists():
        raise SystemExit(f"{dest} already exists")
    dest.mkdir(parents=True)
    fill = lambda text: text.replace("{{TEAM_ID}}", str(team_id)).replace("{{TEAM_NAME}}", team_name)
    for name in ("rules.md", "memory.md"):
        (dest / name).write_text(fill((AGENTS / "_template" / name).read_text()))
    (dest / "persona.md").write_text(fill(pfile.read_text()) + f"\nTeam: {team_name} (team_id {team_id})\n")
    (dest / "decision_log.jsonl").touch()

    path = CONFIG / "league.yaml"
    cfg = yaml.safe_load(path.read_text())
    cfg["dead_teams"] = {**(cfg.get("dead_teams") or {}), team_id: {"slug": slug, "persona": persona}}
    # Rewrite only the dead_teams block to keep the file's comments intact.
    text = path.read_text()
    block = "dead_teams:\n" + "".join(
        f"  {k}: {{slug: {v['slug']}, persona: {v['persona']}}}\n" for k, v in sorted(cfg["dead_teams"].items()))
    text = re.sub(r"^dead_teams:.*?(?=\Z)", block, text, flags=re.S | re.M) if "dead_teams:" in text else text + block
    path.write_text(text)
    print(f"Created {dest} and registered team {team_id} as {slug}")


def cmd_prepare(args):
    if not args:
        raise SystemExit("usage: prepare <tuesday|wednesday|thursday|sunday>")
    week, paths = run_loop.prepare(args[0])
    print(f"Wrote {len(paths)} context bundles for week {week}:")
    for p in paths:
        print("  ", p)
    print("\nNext: have each agent read its bundle and write its moves JSON, then run `collect`.")


def cmd_collect(_):
    week, results, sheet = run_loop.collect()
    ok = sum(len(r["approved"]) for r in results.values())
    bad = sum(len(r["rejected"]) for r in results.values())
    print(f"Week {week}: {ok} approved, {bad} rejected. Move sheet: {sheet}")


def cmd_summary(_):
    print("Wrote", run_loop.summary())


def cmd_status(_):
    cfg, rules = league_cfg(), rules_cfg()
    print(f"League {cfg['league_id']} season {cfg['season']}; my_team_id={cfg.get('my_team_id')}")
    print(f"Paused: {rules.get('paused')}")
    for tid, e in dead_teams(cfg).items():
        print(f"  team {tid}: {e['slug']} ({e['persona']})")
    try:
        snap = espn_client.load_snapshot()
        print(f"Snapshot: week {snap['current_week']}, {espn_client.snapshot_age_hours(snap):.1f}h old")
    except FileNotFoundError:
        print("Snapshot: none yet")


COMMANDS = {"refresh": cmd_refresh, "new-agent": cmd_new_agent, "prepare": cmd_prepare,
            "collect": cmd_collect, "summary": cmd_summary, "status": cmd_status}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in COMMANDS:
        print(__doc__)
        return 1
    try:
        COMMANDS[argv[0]](argv[1:])
    except espn_client.MissingCredentials as e:
        print(f"error: {e}")
        return 2
    return 0
