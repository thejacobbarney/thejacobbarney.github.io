# Huddle — Fantasy Lineup Co-Pilot — Architecture

Huddle is a mobile-first, client-only web app (vanilla HTML/CSS/JS, ES modules) that shows your
ESPN Fantasy Football roster, a start/sit comparison against your bench, waiver-wire add/drop
suggestions, a multi-week outlook (bye weeks, upcoming opponents), your current matchup, and league
standings — built to be checked from a phone, not a desktop dashboard.

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
    lineup.js                    findStartSitSuggestions() (bench vs. starter) and
                                  findWaiverUpgrades() (free agent vs. weakest rostered player at
                                  the same position) — both projected-points comparisons only
    utils.js                     escapeHtml, point formatting
    app.js                       Tab routing, load/refresh/cache orchestration
    aiConfig.js                  localStorage read/write for the optional bring-your-own-key AI
                                   settings — same contract as Pulse's/Iceberg's aiConfig.js
    aiVerify.js                   "Test connection" — smallest possible live Anthropic API call
    components/
      aiSettingsPanel.js            Shared enable/key/model UI, rendered into My Team
    report/
      aiRecommendation.js            generateAiRecommendation() — sends the computed roster/
                                       matchup/waiver summary to Anthropic, gets back a structured
                                       game plan (see §6)
    render/
      setup.js                    League config form
      myTeam.js                   Roster (starters/bench/IR) + inline start/sit callout +
                                    per-player recent-form trend and bye badge + the AI game plan
                                    panel/button/result
      matchup.js                  This week's matchup, my score vs opponent's
      waiver.js                    Add/drop suggestions + browsable free-agent pool by position
      outlook.js                   Bye weeks coming up on your roster + next few opponents
      standings.js                League table sorted by record then points-for
```

Data flow:

```
app.js -> espnClient.fetchLeague() -> Worker (adds ESPN cookie header) -> ESPN Fantasy API
       -> espnClient.normalizeLeague() -> render/*.js -> DOM
       (separately) espnClient.fetchFreeAgents() -> Worker (kona_player_info + X-Fantasy-Filter)
       -> espnClient.normalizeFreeAgents() -> render/waiver.js -> DOM
```

The free-agent fetch is a second, independent request — `app.js: loadLeague()` catches its own
failure separately from the main league fetch, so an older deployed Worker (predating waiver
support) or an ESPN schema change there degrades to "Waivers tab shows an error" rather than
breaking the rest of the app.

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
- `schedule[]` entries are `{ matchupPeriodId, home: { teamId, totalPoints }, away: { ... } }` —
  every matchup for the season is in this one array, not just the current week's, which is what
  lets `upcomingMatchups` in `normalizeLeague()` just filter/sort it rather than making another
  request.
- Team display name falls back through `team.name` → `${location} ${nickname}` → `Team {id}`,
  since ESPN has changed which of these fields is populated across seasons.
- A player's `stats[]` array already includes every completed week's actual score, not just the
  current week — `recentActualPoints()` in `espnClient.js` filters it to `statSourceId === 0`
  (actual) entries before the current week, so the "recent form" trend on My Team is free: no
  extra request, just reading more of data already being fetched.
- Bye weeks (`view=proTeams`, requested alongside the others in `fetchLeague()`) are the least
  certain of these — the exact top-level field name for that array is a guess (`buildByeWeekMap()`
  in `espnClient.js` tries `raw.settings.proTeams` then `raw.proTeams`, each item expected as
  `{ id, byeWeek }`). If it's wrong, bye-week badges and the Outlook tab's bye-week section just
  render nothing (no crash) — that's the one part of this most likely to need a field-name fix
  once tested against a real league.
- The free-agent/waiver pool uses a completely different ESPN view, `view=kona_player_info`, which
  additionally requires a request header (`X-Fantasy-Filter`, a JSON string) rather than just query
  params — that's built server-side in `worker/espn-proxy.js`, not passed through from the client.
  Its response shape is `{ players: [{ player: {...}, onTeamId, ... }] }` — no `lineupSlotId`,
  no `playerPoolEntry` wrapper — which is why `normalizePlayerEntry()` in `espnClient.js` accepts
  either `entry.playerPoolEntry.player` (roster shape) or `entry.player` (free-agent shape).

**None of this has been exercised against a real ESPN league from this environment** — the
sandbox this was built in has no network path to `espn.com` to test against; everything above was
verified with a headless-browser smoke test against hand-built fixture JSON matching this
documented shape, not against ESPN's actual current response. `espnClient.js` is written
defensively (every field access is optional-chained, missing data renders as `—` or an empty
section rather than throwing) specifically so a schema mismatch shows up as a blank cell instead of
a broken page. If a section comes up empty against your real league, that's the first place to
look — tell me what's missing and it's a targeted fix in one file, not a rewrite.

## 3. Start/sit and waiver logic

`lineup.js: findStartSitSuggestions()` compares each starter's projected points against the bench
players who could legally take their slot (same default position, or — for a FLEX slot — any of
RB/WR/TE per `FLEX_ELIGIBLE_POSITIONS`), and only surfaces cases where a bench option projects
*higher*. It says nothing about players it can't compare (no projection yet, bye week with no stat
line) rather than guessing. It's explicitly a projection-only signal — no awareness of injury news
past what ESPN's `injuryStatus` field already says, no weather, no gut feel.

`lineup.js: findWaiverUpgrades()` is the same idea one level out: for each position you roster, it
finds your single weakest player there (by projected points, IR excluded) and checks whether any
available free agent at that position projects higher — one add/drop suggestion per position, not
a ranked list of everyone worth considering. The Waivers tab's "Top available" section below that
is the full browsable pool if the one-line suggestion isn't the move you want.

`render/outlook.js` covers the other direction — not swapping players now, but planning a week
ahead: it lists your next few scheduled opponents (sliced straight out of the same `schedule[]`
array the current matchup uses) and flags any rostered player (IR excluded) whose bye week has
arrived or is coming up, so a bye doesn't surprise you the morning lineups lock.

## 4. AI game plan (optional, bring-your-own-key)

The offline signals (§3) are deliberately narrow — a raw projected-points delta is honest but
thin, and mostly just re-displays a number ESPN's own app already shows. `report/aiRecommendation.js`
is the "so what" layer on top: `render/myTeam.js: buildAiSummary()` packages the current roster
(starters/bench, each with projection, recent-form trend, injury status, bye week), the matchup,
the already-computed start/sit and waiver suggestions, and the upcoming schedule into one JSON
object, and sends it to the Anthropic Messages API directly from the browser — same BYOK pattern as
Pulse's `report/aiReport.js` (`anthropic-dangerous-direct-browser-access`, `output_config.format:
{ type: 'json_schema' }` for a guaranteed-parseable response). Only that computed summary is sent —
never ESPN cookies, never the raw ESPN API response.

The system prompt explicitly tells the model not to just restate the pre-computed suggestions:
it's meant to weigh them against context the raw numbers don't carry (a `QUESTIONABLE` tag, a wide
gap between recent actuals and this week's projection, a bye week two weeks out that changes
whether a waiver move is worth a bench spot now) and say where it agrees, disagrees, or adds
nuance — that's the actual value-add over the free offline comparisons.

`myTeam.js` keeps the last generated recommendation in a module-level `WeakMap` keyed by the
`league` object itself, so switching tabs away and back doesn't lose it (the object reference is
stable until the next fetch), but a fresh fetch — a new `league` object from `app.js` — naturally
starts clean rather than showing a stale recommendation next to this week's new numbers.

## 5. Local persistence, no account

League config (Worker URL, league ID, year, team ID, and — for private leagues — SWID/espn_s2)
lives in `localStorage['huddle:config:v1']`, never anywhere else. The last successfully fetched
league snapshot (including the free-agent pool) is cached in `localStorage['huddle:cache:v2']`
purely so reopening the app on a spotty phone connection shows *something* instantly (with a
"showing cached data" note) while a fresh fetch runs in the background — same pattern as Pulse's
`reportCache.js`. (Bumped from `v1` to `v2` when the free-agent/bye-week/outlook fields were added,
so an old cached snapshot from before this change doesn't get fed to render code expecting the new
shape — it's just a cache key, so nothing needed migrating, the old entry is simply never read.)

SWID/espn_s2 cookies are ESPN's own session cookies, not a Huddle-issued credential — they expire
periodically (weeks to months), at which point requests to a private league start failing and
they need refreshing from a logged-in `fantasy.espn.com` browser session (Settings → the two
private-league fields).

## 6. Cache-busting

Same manual-versioning approach as the rest of the site (see Pulse's ARCHITECTURE.md §8) — bump
`?v=N` on `css/style.css`'s `<link>` in `index.html` any time the stylesheet changes.
