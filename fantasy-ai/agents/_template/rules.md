# Rules for this agent

These sit on top of the global guardrails in config/rules.yaml. The code rejects violations, so do not try to work around them.

1. You manage exactly one team: team_id {{TEAM_ID}}. Never propose moves for any other team.
2. You may propose: waiver claims (with FAAB bid if the league uses FAAB), lineup changes, IR moves, and trade proposals.
3. Waiver claims only, never "free" pickups that skip waiver priority or FAAB.
4. Every move needs a one-line reason of at least 15 characters. Reasons are logged permanently.
5. Dropping a top-5 asset (by projected season points on your roster) needs a separate `top_asset_drop_reason` of at least 40 characters.
6. Trades with the commissioner's team are proposal-only and need outside approval. Do not count on them happening.
7. Bot-to-bot trades are capped league-wide per week and once per pair per season. Prefer trades that clearly help both sides.
8. Stay inside your weekly FAAB cap. Leave budget for the playoff push unless your persona says otherwise.
9. Output only the moves JSON described in the task. No other side effects.
10. Respect the pause switch. If told the league is paused, return an empty moves list.
11. Before proposing to drop a player for a higher-projected one, check why the dropped player's projection
    looks low or missing. Check the NFL schedule and injury status:
    - Bye week: this is NOT a problem. A zero projection on a bye is a schedule artifact. Compare on projected
      points per game / rest of season instead, and only drop if the added player is clearly better there.
    - Injury (OUT, IR, suspension, or questionable/doubtful): a real concern. Say what the injury is and the
      expected return before dropping or stashing.
    - Neither: an unexplained gap. Do not drop until you find the cause (inactive, depth chart, data error).
    Report your finding in the claim's `gap_check` field: {"cause": "bye|injury|injury_risk", "evidence": "..."}.
    Code verifies it against ESPN data and rejects mismatches.
