"""Shared scoring/lineup/drop-protection logic (pure functions; no team data is stored here)."""
from common import cfg
STARTERS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 2, "D/ST": 1, "K": 1}
OUT_THIS_WEEK = {"OUT", "INJURY_RESERVE", "DOUBTFUL", "SUSPENSION"}
NO_MARKET_PROTECT = {"K", "D/ST"}          # ownership % is inflated for these
_c = cfg(); g = _c["guardrails"]; overrides = _c.get("drop_overrides", {})

def value(p, k):
    """Rest-of-season value. Ignores short-term injury tags so a Doubtful star is still a star."""
    hi, lo = max(p["proj"], p["avg"]), min(p["proj"], p["avg"])
    return 0.6*hi + 0.4*lo + k["upside"]*(p["own"]/100)*5 + (p["own"]/100)*4
def week_score(p, k):
    """This-week start/sit score. Injury tags matter here, but never for drops."""
    if str(p["inj"]) in OUT_THIS_WEEK or p.get("bye"): return -1
    if p.get("week_proj") is not None: return p["week_proj"] + k["upside"]*(p["own"]/100)*2
    return k["weight_proj"]*p["proj"] + k["weight_avg"]*p["avg"] + k["upside"]*(p["own"]/100)*5

def protected(p, roster, k):
    """Return a reason string if p may not be dropped, else None."""
    if str(p["id"]) in overrides: return None
    ranked = sorted(roster, key=lambda x: -value(x, k))
    if p["id"] in {x["id"] for x in ranked[:g["protect_top_n"]]}: return f"top-{g['protect_top_n']} roster asset"
    if p["pos"] not in NO_MARKET_PROTECT and p["own"] >= g["protect_if_owned_pct_at_least"]:
        return f"{p['own']:.0f}% rostered league-wide"
    if p["inj"] in ("QUESTIONABLE", "DOUBTFUL", "OUT") and p["own"] >= 40:
        return "short-term injury, not a drop reason"
    return None
def needed_gain(dropped, fa, k):
    if fa["pos"] in k["stream"]: return g["min_upgrade_pts_stream"]
    return max(g["min_upgrade_pts"], value(dropped, k) * g["min_upgrade_pct_of_dropped"]/100)

def keep_questionable(p):
    """Rule: a Questionable starter stays in the lineup unless ESPN projects him for 0 this week."""
    return p["slot"] in STARTERS and str(p["inj"]) == "QUESTIONABLE" and (p.get("week_proj") or 0) > 0 and not p.get("bye")
def lineup(roster, k):
    pool = sorted([p for p in roster if p["slot"] != "IR" and p["inj"] != "INJURY_RESERVE"], key=lambda p: -week_score(p, k))
    used, out = set(), []
    for p in roster:   # lock protected Questionable starters into their current slot first
        if keep_questionable(p): used.add(p["id"]); out.append((p["slot"], p))
    for slot, n in STARTERS.items():
        ok = ["RB", "WR", "TE"] if slot == "RB/WR/TE" else [slot]
        n -= sum(1 for s, _ in out if s == slot)
        if n <= 0: continue
        for p in [p for p in pool if p["pos"] in ok and p["id"] not in used][:n]:
            used.add(p["id"]); out.append((slot, p))
    return out, used

