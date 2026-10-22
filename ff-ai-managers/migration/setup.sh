#!/usr/bin/env bash
# One-time setup on the new host. Run from anywhere: bash migration/setup.sh
set -e
cd "$(dirname "$0")/.."
command -v python3 >/dev/null || { echo "Install Python 3.10+ first"; exit 1; }
python3 -c 'import sys; assert sys.version_info>=(3,10), "Python 3.10+ required"'
python3 -m venv .venv
. .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
[ -f .env ] || { cp .env.example .env; echo "Created .env from template - fill in SWID and ESPN_S2"; }
chmod 600 .env
chmod +x run_week.sh migration/*.sh
mkdir -p shared/proposals move_sheets
echo "Setup done. Next: .venv/bin/python migration/healthcheck.py"
