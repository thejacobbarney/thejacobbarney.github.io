# AI managers — ESPN fantasy league
Setup: `pip install espn-api`, `cp .env.example .env`, paste SWID/ESPN_S2 (or export as env vars). `.env` is gitignored.
1. `python src/scaffold.py` — creates teams/<id>_<name>/{persona.md, rules.md, memory.md, log.jsonl}. Edit config/league.json to change which teams are bots and their persona.
2. `./run_week.sh <tuesday|wednesday|thursday|sunday>` — pull data → lineup/IR moves auto-approved, claims and trades written as pending proposals → lists them.
3. `python src/approve.py approve <ids|all|team N>` or `reject <ids> "reason"` — commissioner approval; decisions logged.
4. `python src/move_sheet.py` — move_sheets/weekN.md with approved moves only.
5. Pause: set `"paused": true` in config/league.json.
my_team/ is never read by the bot loop. Cookies expire: when pulls 401, refresh them from browser devtools.
Trade ideas are flagged only; nothing trades automatically.
Duplicate-claim rule: bots claim in waiver-priority order; a player claimed by one bot (this run or earlier this week, per the logs) is skipped by the others.

Drop protection: value ignores short-term injury tags; protected players (top-5, 60%+ rostered, injured but 40%+ rostered) can only be dropped via config `drop_overrides` with a reason. Blocked drops are logged as BLOCKED_DROP.

Bots (full agents): the teams listed under bot_teams in config/league.json.
Assist (suggestions only, no auto moves, no trades): the commissioner's own team (output in my_team/, isolated) and the other human-managed teams listed under assist_teams in config/league.json. Run: `python src/assist.py <phase>` (also run by run_week.sh).

Execution (current): moves use League Manager tools from the commissioner login (SWID/ESPN_S2 in .env). Lineup and add/drop go to the LM write API; waiver claims are submitted as the team owner so normal priority applies. The older per-team-manager option (SWID_TEAM_<id>/ESPN_S2_TEAM_<id>) is still supported by common.team_creds but not in use.
