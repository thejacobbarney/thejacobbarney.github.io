"""Hard guardrails. Every proposed move passes through validate() before it can reach the move sheet.

validate(doc, snapshot, rules, cfg, state) -> (approved, rejected)
  approved: list of moves, annotated with "requires_outside_approval" where relevant
  rejected: list of {"move": ..., "violations": [...]}
`state` carries cross-agent counters for the week (bot-to-bot trades so far).
"""
from . import decision_log
from .config import dead_teams

MOVE_TYPES = {"waiver_claim", "lineup", "ir_move", "trade_proposal"}


def new_state():
    return {"bot_bot_trades_this_week": 0, "teams": {}}


def _team(snapshot, team_id):
    for t in snapshot["teams"]:
        if t["team_id"] == team_id:
            return t
    return None


def _asset_value(p):
    return max(p.get("projected_total_points") or 0, p.get("total_points") or 0,
               (p.get("avg_points") or 0) * 17)


def top_assets(team, n):
    ranked = sorted(team["roster"], key=_asset_value, reverse=True)
    return {p["id"] for p in ranked[:n]}


def _rostered_ids(snapshot):
    return {p["id"]: t["team_id"] for t in snapshot["teams"] for p in t["roster"]}


def validate(doc, snapshot, rules, cfg, state):
    team_id = int(doc["team_id"])
    bots = dead_teams(cfg)
    me = cfg.get("my_team_id")
    slugs = {tid: v["slug"] for tid, v in bots.items()}
    approved, rejected = [], []

    def reject(move, *why):
        rejected.append({"move": move, "violations": list(why)})

    if rules.get("paused"):
        for m in doc.get("moves", []):
            reject(m, "league is paused")
        return approved, rejected
    if team_id not in bots:
        for m in doc.get("moves", []):
            reject(m, f"team {team_id} is not a managed dead team")
        return approved, rejected

    team = _team(snapshot, team_id)
    if team is None:
        for m in doc.get("moves", []):
            reject(m, f"team {team_id} not in snapshot")
        return approved, rejected

    pw = rules["per_agent_weekly"]
    s = snapshot["settings"]
    roster_ids = {p["id"] for p in team["roster"]}
    owner_of = _rostered_ids(snapshot)
    top = top_assets(team, rules["top_asset_rank"])
    faab_cap = (s.get("acquisition_budget") or 0) * pw["max_faab_pct_of_budget"] / 100
    faab_left = team.get("faab_remaining")

    # Weekly counters span every phase file for the team, so caps are per week, not per file.
    c = state["teams"].setdefault(team_id, {"claims": 0, "trades": 0, "faab": 0})

    for m in doc.get("moves", []):
        why = []
        t = m.get("type")
        if t not in MOVE_TYPES:
            reject(m, f"unknown move type {t!r}")
            continue
        if len((m.get("reason") or "").strip()) < rules["min_reason_chars"]:
            why.append(f"reason shorter than {rules['min_reason_chars']} chars")

        if t == "waiver_claim":
            add, drop = m.get("add") or {}, m.get("drop")
            bid = int(m.get("faab_bid") or 0)
            if not add.get("id"):
                why.append("missing add.id")
            elif add["id"] in owner_of:
                why.append(f"{add.get('name', add['id'])} is already on a roster")
            if drop:
                if drop.get("id") not in roster_ids:
                    why.append("drop player is not on this team's roster")
                elif drop["id"] in top and len((m.get("top_asset_drop_reason") or "").strip()) < rules["top_asset_drop_min_reason_chars"]:
                    why.append(f"dropping a top-{rules['top_asset_rank']} asset needs top_asset_drop_reason "
                               f"(>= {rules['top_asset_drop_min_reason_chars']} chars)")
            if s.get("faab"):
                if bid < (s.get("minimum_bid") or 0):
                    why.append(f"bid {bid} below minimum {s.get('minimum_bid')}")
                if faab_left is not None and c['faab'] + bid > faab_left:
                    why.append(f"bid exceeds FAAB remaining ({faab_left - c['faab']} left)")
                if c['faab'] + bid > faab_cap:
                    why.append(f"weekly FAAB cap {faab_cap:.0f} exceeded")
            c["claims"] += 1
            if c["claims"] > pw["max_waiver_claims"]:
                why.append(f"more than {pw['max_waiver_claims']} waiver claims this week")
            if not why:
                c["faab"] += bid

        elif t == "lineup":
            for c in m.get("changes", []):
                if c.get("player", {}).get("id") not in roster_ids:
                    why.append(f"lineup player {c.get('player', {}).get('name')} not on roster")

        elif t == "ir_move":
            pid = (m.get("move_to_ir") or {}).get("id")
            if pid not in roster_ids:
                why.append("IR player not on roster")

        elif t == "trade_proposal":
            to = int(m.get("to_team_id", -1))
            if to == team_id or _team(snapshot, to) is None:
                why.append("invalid trade partner")
            give, get = m.get("give") or [], m.get("get") or []
            if not give or not get:
                why.append("trade needs players on both sides")
            if any(p.get("id") not in roster_ids for p in give):
                why.append("give includes a player not on this roster")
            partner = _team(snapshot, to)
            if partner and any(p.get("id") not in {x["id"] for x in partner["roster"]} for p in get):
                why.append("get includes a player not on the partner's roster")
            c["trades"] += 1
            if c["trades"] > pw["max_trade_proposals"]:
                why.append(f"more than {pw['max_trade_proposals']} trade proposals this week")
            if to in bots:
                bb = rules["bot_to_bot_trades"]
                if state["bot_bot_trades_this_week"] >= bb["max_per_week_league_wide"]:
                    why.append("league-wide weekly bot-to-bot trade cap reached")
                if decision_log.approved_trades_between(team_id, to, slugs) >= bb["max_per_pair_per_season"]:
                    why.append("these two bots already traded this season")

        if why:
            reject(m, *why)
            continue

        out = dict(m)
        if t == "trade_proposal":
            to = int(m["to_team_id"])
            out["execution"] = "proposal_only"
            if me is not None and me in (team_id, to):
                out["requires_outside_approval"] = bool(
                    rules["my_team_trades"]["require_outside_approval"])
            if to in bots:
                state["bot_bot_trades_this_week"] += 1
        out["commissioner_edit"] = t in rules.get("commissioner_edit_types", [])
        approved.append(out)

    return approved, rejected
