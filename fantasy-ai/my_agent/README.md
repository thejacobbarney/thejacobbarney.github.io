# My agent (isolated)

This agent manages the commissioner's own active team. It shares NOTHING with the bot agents:

- Never read anything under `../agents/` (no personas, memory, or decision logs from the bots).
- Never write into `../agents/`.
- It may use the shared league snapshot (`../data/snapshot.json`), which is public league information anyway.
- Trades with bot teams are proposal-only and need outside approval (see `../config/rules.yaml`).

Copy `../agents/_template/{persona,rules,memory}.md` here and fill them in with your own strategy.
