#!/usr/bin/env bash
# cron (America/Phoenix): Tue 21:00 tuesday | Wed 06:00 wednesday | Thu 09:00 thursday | Sun 08:30 sunday
# Bots propose claims/trades -> python src/approve.py. Thursday/Sunday also auto-fix dead starters
# (bye, Out/IR/Doubtful, projected 0) on bot teams via src/lineup_check.py --apply.
set -e; cd "$(dirname "$0")"; export PYTHONPATH=$PWD/src; [ -d .venv ] && . .venv/bin/activate
PHASE="${1:-tuesday}"
python src/pull_data.py
python src/run_agents.py "$PHASE"   # exits non-zero when paused; set -e then stops the whole run
python src/assist.py "$PHASE"
if [[ "$PHASE" == "thursday" || "$PHASE" == "sunday" ]]; then python src/lineup_check.py --apply; fi
python src/approve.py
