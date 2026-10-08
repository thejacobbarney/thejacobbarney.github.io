"""Why does a player have a projection gap: bye week, injury, or nothing we can explain?

A "gap" is a missing or zero projection for the current week. A bye week is NOT a reason to drop a
player: the zero is an artifact of the schedule, so such players are compared on per-game value instead.
"""

OUT_STATUSES = {"OUT", "INJURY_RESERVE", "SUSPENSION"}
RISK_STATUSES = {"QUESTIONABLE", "DOUBTFUL", "DAY_TO_DAY"}


def has_gap(player):
    return not (player.get("week_projected") or 0)


def on_bye(player, week):
    return player.get("bye_week") == week


def kind(player, week):
    """bye | injured_out | injured_risk | healthy. A player who is OUT is reported as injured even on a bye,
    because the injury is a real concern that the bye does not explain away."""
    status = (player.get("injury_status") or "ACTIVE").upper()
    if status in OUT_STATUSES:
        return "injured_out"
    if on_bye(player, week):
        return "bye"
    if status in RISK_STATUSES:
        return "injured_risk"
    return "healthy"


def gap_cause(player, week):
    """None if there is no gap, else bye | injury | injury_risk | unexplained."""
    if not has_gap(player):
        return None
    return {"bye": "bye", "injured_out": "injury", "injured_risk": "injury_risk",
            "healthy": "unexplained"}[kind(player, week)]


def annotate(player, week):
    """Fields shown to agents so they can do the check themselves."""
    return {"availability": kind(player, week), "gap_cause": gap_cause(player, week),
            "on_bye_this_week": on_bye(player, week)}
