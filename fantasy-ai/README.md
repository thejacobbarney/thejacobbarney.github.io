# AI managers for abandoned ESPN fantasy football teams

One agent per dead team, each with its own persona, rules, memory, and decision log. Agents propose
moves as JSON; code-enforced guardrails validate them; you click the approved ones through from a weekly
move sheet.

```
config/league.yaml     league id, season, my_team_id, dead_teams registry
config/rules.yaml      guardrails (FAAB cap, trade caps, top-5 drop rule, pause switch)
personas/              the 5 starter personas (quant, stash_king, trade_shark, contrarian, safe_floor)
agents/_template/      persona / rules / memory templates
agents/<slug>/         one folder per dead team (persona.md, rules.md, memory.md, decision_log.jsonl)
my_agent/              YOUR team's agent. Shares nothing with agents/ (see its README)
data/snapshot.json     shared data layer (gitignored)
out/week-NN/           context bundles, agent moves, move_sheet.md, weekly_summary.md (gitignored)
src/fantasy_ai/        the code
```

## Setup

```bash
pip install -r requirements.txt
export ESPN_S2='<espn_s2 cookie>'     # cookies live in your environment only, never in files
export ESPN_SWID='{<SWID cookie>}'
cd fantasy-ai && export PYTHONPATH=src
python -m fantasy_ai refresh          # prints every team id, owner, record, plus FAAB/trade settings
```

Fill `my_team_id` in `config/league.yaml`, then create one agent per dead team:

```bash
python -m fantasy_ai new-agent 3 quant
python -m fantasy_ai new-agent 5 stash_king
python -m fantasy_ai new-agent 7 trade_shark
python -m fantasy_ai new-agent 8 contrarian
python -m fantasy_ai new-agent 9 safe_floor
```

Cookies expire. When `refresh` fails with ESPNAccessDenied, copy fresh `espn_s2` and `SWID` values from
your browser (DevTools, Application, Cookies, espn.com).

## Weekly schedule

| When | Command | What the agents do |
|---|---|---|
| Tue night | `refresh`, `prepare tuesday` | read data, rewrite memory.md strategy notes |
| Wed | `refresh`, `prepare wednesday`, then `collect` | waiver claims (priority/FAAB) and trade proposals |
| Thu morning | `refresh`, `prepare thursday`, then `collect` | lineup and IR check before kickoff |
| Sun, ~90 min before early games | `refresh`, `prepare sunday`, then `collect` | inactives scan, lineup swaps |
| Sun night / Mon | `summary` | weekly summary for you |

Between `prepare` and `collect`, each agent (for example one Claude Code subagent per team) reads
`out/week-NN/<slug>/<phase>.md` and writes `out/week-NN/moves/<slug>.<phase>.json`. The bundle contains the
agent's own persona, rules and memory, and the league data, and nothing from other agents' folders.
`collect` writes `out/week-NN/move_sheet.md`: that is your 10-minute click-through.

## Guardrails (config/rules.yaml, enforced in code)

- Weekly FAAB spend cap (20% of budget by default), at most 4 claims and 2 trade proposals per agent per week.
- Dropping a top-5 asset (by projected season points) requires a logged `top_asset_drop_reason`.
- Bot-to-bot trades: 1 per week league-wide, and each pair of bots may trade once per season.
- Trades touching your team are proposal-only and flagged "needs outside approval".
- Drop-for-higher-projection check: if the player being dropped has a missing or zero week projection, the
  agent must report why in `gap_check`. Code compares it with ESPN's schedule and injury data. A bye week is
  never a reason to drop (judged on per-game value instead), an injury is a real concern, and an unexplained
  gap blocks the drop.
- Every move needs a one-line reason, logged to `agents/<slug>/decision_log.jsonl`.
- Pause switch: set `paused: true` in `config/rules.yaml`. Everything is rejected until you flip it back.
- Real waiver claims for add/drops. Commissioner edits are reserved for lineup and IR fixes.

## Tests

```bash
python -m unittest discover -s tests -v
```

They run the full week against a synthetic league, no ESPN access needed.

## Phase 2: browser automation (after 2 or 3 weeks of move sheets)

Not built yet. The plan is to read `out/week-NN/move_sheet.json` and drive ESPN through Claude in Chrome
with your commissioner session, then call `decision_log.mark(slug, id, "executed")` per move. Keep the
confirm-before-submit step for trades until you trust it.

## Security

This folder lives inside a public GitHub Pages repo. Do not commit `agents/`, `data/` or `out/` there.
Move the project to a private repo first, and never put cookies in any file.
