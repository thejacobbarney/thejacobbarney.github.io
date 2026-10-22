# Deploying the dashboard to Render

Source lives in `ff-ai-managers/`; the Blueprint is `render.yaml` at the repo root.

## Safety defaults
- `config/league.json` ships with `"paused": true`. While paused, every ESPN write (`lineup`, `free_agent`, `waiver_claim`) is refused in `src/espn_write.py`, `lineup_check.py --apply` exits, and `run_week.sh` stops before `--apply`.
- Dry runs (`python src/lineup_check.py` with no `--apply`) are read-only and work while paused.
- `render.yaml` has `autoDeploy: false` and defines only the web service. The old no-op scheduler worker was removed; add a real one only after the dry-run phase.
- Credentials are set only as Render environment variables (`SWID`, `ESPN_S2`, `LEAGUE_ID`, `DASHBOARD_API_TOKEN`). Never commit `.env`. `.dockerignore` keeps it out of the image.
- The uploaded backup contained live ESPN cookies. Refresh them (log into ESPN again) before putting them in Render.
- League data (team logs, memory, proposals, rosters) is intentionally not in this repo.

## Rollout order
1. Review and merge the application files.
2. Create the Render service from the Blueprint with automation paused. Set the env vars, then deploy by hand.
3. Verify: `GET /health` (open), then with header `X-Dashboard-Token`: `GET /api/status` and `GET /api/espn-check` (read-only ESPN call). Then in a Render shell: `python src/scaffold.py` to create the team folders, and `python migration/healthcheck.py`.
4. Dry run: `PYTHONPATH=src python src/pull_data.py && PYTHONPATH=src python src/lineup_check.py` (no `--apply`) and inspect the output.
5. Only after that, consider un-pausing (edit `config/league.json`, redeploy) and a first single-team `--apply`.

## Known limits
- State is files on the container disk, which is ephemeral on Render. A restart loses dashboard decisions and snapshots, and resets `paused` to the shipped `true` (the safe direction). Add a persistent disk or a database before relying on it.
- Run a single instance. Web approvals only record a decision; they do not execute ESPN transactions.
- `/health` is unauthenticated by design; all other API routes require the token.
