import os
from pathlib import Path

# FANTASY_AI_ROOT lets tests run against a scratch copy of the project.
ROOT = Path(os.environ.get("FANTASY_AI_ROOT") or Path(__file__).resolve().parents[2])
CONFIG = ROOT / "config"
AGENTS = ROOT / "agents"
PERSONAS = ROOT / "personas"
DATA = ROOT / "data"
OUT = ROOT / "out"
SNAPSHOT = DATA / "snapshot.json"


def week_dir(week: int) -> Path:
    d = OUT / f"week-{week:02d}"
    d.mkdir(parents=True, exist_ok=True)
    return d
