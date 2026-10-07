"""Render the weekly move sheet: the checklist you click through (about 10 minutes)."""
from datetime import datetime


def _p(x):
    return x.get("name") or str(x.get("id"))


def render(week, teams_by_id, results):
    """results: {team_id: {"slug":..., "approved":[...], "rejected":[...]}}"""
    lines = [f"# Move sheet: week {week}", "",
             f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}. Tick each box as you execute it in ESPN.", ""]
    total = 0
    for tid, r in sorted(results.items()):
        name = teams_by_id.get(tid, {}).get("name", f"team {tid}")
        lines += [f"## {name} (id {tid}, {r['slug']})", ""]
        if not r["approved"]:
            lines += ["_No approved moves._", ""]
        for m in r["approved"]:
            total += 1
            t, why = m["type"], m.get("reason", "")
            tag = " **[commissioner edit]**" if m.get("commissioner_edit") else ""
            if t == "waiver_claim":
                drop = f", drop {_p(m['drop'])}" if m.get("drop") else ""
                bid = f", bid ${m.get('faab_bid', 0)}" if m.get("faab_bid") is not None else ""
                lines.append(f"- [ ] **Waiver claim**: add {_p(m['add'])}{drop}{bid}. _{why}_")
            elif t == "lineup":
                for c in m.get("changes", []):
                    lines.append(f"- [ ] **Lineup**: {_p(c['player'])} {c.get('from_slot', '?')} -> "
                                 f"{c.get('to_slot', '?')}.{tag} _{why}_")
            elif t == "ir_move":
                swap = f", bring in {_p(m['drop_or_swap_in'])}" if m.get("drop_or_swap_in") else ""
                lines.append(f"- [ ] **IR**: move {_p(m['move_to_ir'])} to IR{swap}.{tag} _{why}_")
            elif t == "trade_proposal":
                give = " + ".join(_p(p) for p in m["give"])
                get = " + ".join(_p(p) for p in m["get"])
                note = " **NEEDS OUTSIDE APPROVAL (proposal only)**" if m.get("requires_outside_approval") else " (proposal only)"
                other = teams_by_id.get(int(m["to_team_id"]), {}).get("name", m["to_team_id"])
                lines.append(f"- [ ] **Trade proposal** to {other}: give {give}, get {get}.{note} _{why}_")
        if r["rejected"]:
            lines += ["", "<details><summary>Rejected by guardrails</summary>", ""]
            for x in r["rejected"]:
                lines.append(f"- {x['move'].get('type')}: {'; '.join(x['violations'])}")
            lines += ["", "</details>"]
        lines.append("")
    lines.insert(3, f"**{total} approved moves.**")
    return "\n".join(lines) + "\n"
