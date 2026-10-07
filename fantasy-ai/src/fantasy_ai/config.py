import yaml

from .paths import CONFIG


def _load(name):
    with open(CONFIG / name) as f:
        return yaml.safe_load(f) or {}


def league_cfg():
    return _load("league.yaml")


def rules_cfg():
    return _load("rules.yaml")


def dead_teams(cfg=None):
    """Return {team_id(int): {slug, persona}}."""
    cfg = cfg or league_cfg()
    return {int(k): v for k, v in (cfg.get("dead_teams") or {}).items()}
