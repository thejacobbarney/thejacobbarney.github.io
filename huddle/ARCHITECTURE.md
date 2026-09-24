# Huddle — Fantasy Lineup Co-Pilot — Architecture

Huddle is a mobile-first, client-only web app (vanilla HTML/CSS/JS, ES modules) that shows your
ESPN Fantasy Football roster, a start/sit comparison against your bench, your current matchup, and
league standings — built to be checked from a phone, not a desktop dashboard.

## 0. Why this isn't purely static like Pulse/Iceberg

ESPN's Fantasy API does not send CORS headers for third-party origins, so a browser running on
`thejacobbarney.com` cannot call it directly — the request is blocked by the browser before it
ever reaches ESPN, no matter what the page's JS does. Every other app on this site (Bark, Iceberg,
Pulse) avoids this entirely by only ever processing data the person uploads themselves. Huddle
needs *live* league data, so it needs one small piece of server-side infrastructure: a Cloudflare
Worker that forwards the request to ESPN and hands back the JSON with CORS headers that do allow
this site. See `worker/espn-proxy.js` — it holds no secrets and stores nothing; every request
carries its own league ID, year, and (optional) cookies as query params and those are forwarded
straight through to ESPN and forgotten.

**Setup (one-time, ~5 minutes, from a computer):**
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up free (no credit card).
2. **Workers & Pages** → **Create** → **Create Worker**. Give it any name (e.g. `huddle-espn-proxy`).
3. It opens an editor with placeholder code — delete it, paste in the full contents of
   `worker/espn-proxy.js`, and click **Deploy**.
4. Copy the `*.workers.dev` URL it gives you (e.g. `https://huddle-espn-proxy.yourname.workers.dev`).
5. Open `/huddle/` on the site, tap the gear icon, and paste that URL into **Worker URL**.

That's it — no further deploys needed unless you edit the Worker script itself. The free tier
(100,000 requests/day) is far more than one person checking a fantasy team needs.

If you ever fork this for a different domain, add it to `ALLOWED_ORIGINS` in `espn-proxy.js` and
redeploy — the Worker only echoes back CORS approval for origins on that explicit list.

## 1. File layout

```
huddle/
  index.html                Page shell: dark sticky header, #app-root, bottom tab bar
  css/style.css              Two-surface design (dark ink header/tabs, white paper cards),
                               same language as Pulse but turf-green/gold instead of steel blue
  worker/espn-proxy.js         The Cloudflare Worker — deploy separately, see §0
  js/
    constants.js                ESPN's internal ID -> label maps (pro teams, lineup slots,
                                  default positions) — see §2 for how these were sourced
    storage.js                  localStorage read/write for league config (incl. ESPN cookies,
                                  if the league is private) — local-only, same posture as Pulse
    espnClient.js                fetchLeague() (calls the Worker) + normalizeLeague() (raw ESPN
                                  JSON -> the small shape every render/*.js module consumes)
    lineup.js                    findStartSitSuggestions() — bench-vs-starter projected-points
                                  comparison, respecting FLEX eligibility
    utils.js                     escapeHtml, point formatting
    app.js                       Tab routing, load/refresh/cache orchestration
    render/
      setup.js                    League config form
      myTeam.js                   Roster (starters/bench/IR) + inline start/sit callout
      matchup.js                  This week's matchup, my score vs opponent's
      standings.js                League table sorted by record then points-for
```

Data flow:

```
app.js -> espnClient.fetchLeague() -> Worker (adds ESPN cookie header) -> ESPN Fantasy API
       -> espnClient.normalizeLeague() -> render/*.js -> DOM
```

## 2. ESPN's response shape (undocumented — sourced from community reverse engineering)

ESPN has no official public API docs for this. The field names and ID mappings in
`constants.js` and `espnClient.js` come from years of community reverse-engineering (the same
mappings used by projects like `cwendt94/espn-api`), not from anything ESPN publishes. Key
assumptions, in case ESPN changes something and a section of the page comes up empty:

- The league object (requested with `view=mRoster&view=mTeam&view=mMatchup&view=mSettings`) has
  top-level `scoringPeriodId` (current week), `teams[]`, and `schedule[]`.
- Each team has `roster.entries[]`, and each entry is `{ lineupSlotId, playerPoolEntry: { player } }`.
- A player's projected/actual points for a given week live in `player.stats[]`, filtered to the
  entry where `scoringPeriodId` matches the week and `statSourceId` is `1` (projected) or `0`
  (actual), reading `.appliedTotal`.
- `schedule[]` entries are `{ matchupPeriodId, home: { teamId, totalPoints }, away: { ... } }`.
- Team display name falls back through `team.name` → `${location} ${nickname}` → `Team {id}`,
  since ESPN has changed which of these fields is populated across seasons.

**This has not been exercised against a real ESPN league from this environment** — the sandbox
this was built in has no network path to `espn.com` to test against. `espnClient.js` is written
defensively (every field access is optional-chained, missing data renders as `—` rather than
throwing) specifically so a schema mismatch shows up as a blank cell instead of a broken page. If
a section comes up empty against your real league, that's the first place to look — tell me what's
missing and it's a targeted fix in one file, not a rewrite.

## 3. Start/sit logic

`lineup.js: findStartSitSuggestions()` compares each starter's projected points against the bench
players who could legally take their slot (same default position, or — for a FLEX slot — any of
RB/WR/TE per `FLEX_ELIGIBLE_POSITIONS`), and only surfaces cases where a bench option projects
*higher*. It says nothing about players it can't compare (no projection yet, bye week with no stat
line) rather than guessing. It's explicitly a projection-only signal — no awareness of injury news
past what ESPN's `injuryStatus` field already says, no weather, no gut feel.

## 4. Local persistence, no account

League config (Worker URL, league ID, year, team ID, and — for private leagues — SWID/espn_s2)
lives in `localStorage['huddle:config:v1']`, never anywhere else. The last successfully fetched
league snapshot is cached in `localStorage['huddle:cache:v1']` purely so reopening the app on a
spotty phone connection shows *something* instantly (with a "showing cached data" note) while a
fresh fetch runs in the background — same pattern as Pulse's `reportCache.js`.

SWID/espn_s2 cookies are ESPN's own session cookies, not a Huddle-issued credential — they expire
periodically (weeks to months), at which point requests to a private league start failing and
they need refreshing from a logged-in `fantasy.espn.com` browser session (Settings → the two
private-league fields).

## 5. Cache-busting

Same manual-versioning approach as the rest of the site (see Pulse's ARCHITECTURE.md §8) — bump
`?v=N` on `css/style.css`'s `<link>` in `index.html` any time the stylesheet changes.
