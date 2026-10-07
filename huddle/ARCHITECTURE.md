# Huddle — Fantasy Lineup Co-Pilot — Architecture

Huddle is a mobile-first, client-only web app (vanilla HTML/CSS/JS, ES modules) that shows your
ESPN Fantasy Football roster, a start/sit comparison against your bench, waiver-wire add/drop
suggestions, a trade builder/evaluator against any other team in the league, a multi-week outlook
(bye weeks, upcoming opponents), your current matchup, and league standings — built to be checked
from a phone, not a desktop dashboard.

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
    lineup.js                    findStartSitSuggestions() (bench vs. starter), findWaiverUpgrades()
                                  (free agent vs. weakest rostered player at the same position), and
                                  playerValue() (see §3) — the shared "how good is this player right
                                  now" signal all three of the above, plus trade.js, are built on
    trade.js                      evaluateTrade() — compares two lists of players (what you'd give
                                    vs. receive) by playerValue(), works for either building an
                                    offer or checking one someone sent you (see §4)
    utils.js                     escapeHtml, point formatting
    app.js                       Tab routing, load/refresh/cache orchestration
    perplexityConfig.js          localStorage read/write for the Perplexity key/model (§5c)
    grokConfig.js                localStorage read/write for the Grok key/model (§5b)
    aiConfig.js                  localStorage read/write for the optional bring-your-own-key AI
                                   settings — same contract as Pulse's/Iceberg's aiConfig.js
    aiVerify.js                   "Test connection" — smallest possible live Anthropic API call
    components/
      perplexitySettingsPanel.js    Perplexity key/model UI (same shape as grokSettingsPanel.js)
      aiViews.js                    "Other AI views" dropdown + "Compare all AI views" (all 3 tabs)
      researchCards.js              Result cards for every AI view and the final analysis
      grokSettingsPanel.js          Grok key/model UI (same shape as aiSettingsPanel.js)
      aiSettingsPanel.js            Shared enable/key/model UI, rendered into My Team
    report/
      aiRecommendation.js            generateAiRecommendation() — sends the computed roster/
                                       matchup/waiver summary to Anthropic, gets back a structured
                                       game plan (see §5)
      claudeJson.js                  One structured-output Anthropic call, used by aiWaiver/aiSynthesis
      aiWaiver.js                    Claude's waiver check (offline data, no search), see §5d
      aiSynthesis.js                 Final analysis across all AI views, see §5d
      research/                      Live-search providers, one runner per provider, see §5b-§5d:
        prompts.js, normalize.js, kinds.js   per-decision prompts (trade/waiver/lineup) and parsers
        grok.js, perplexity.js              runGrok()/runPerplexity(kind, summary, cfg), verify calls
      aiTrade.js                     generateTradeAnalysis() — same BYOK contract, evaluates a
                                       specific trade against both teams' full rosters (see §4)
    render/
      setup.js                    League config form
      myTeam.js                   Roster (starters/bench/IR) + inline start/sit callout +
                                    per-player recent-form trend and bye badge + the AI game plan
                                    panel/button/result
      matchup.js                  This week's matchup, my score vs opponent's
      waiver.js                    Add/drop suggestions + browsable free-agent pool by position
      trade.js                     Trade partner picker, two-column player checklist (give/get),
                                     live value comparison, optional AI trade analysis
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
- `view=mRoster` is assumed to return **every team's** roster in one payload, not just the team
  matching `config.teamId` — `normalizeLeague()` builds a `roster` array on every entry in `teams[]`
  this way, which is what lets the Trade tab show a trade partner's roster with no extra request.
  This is the single least-tested assumption behind a whole feature rather than one field: if a
  future ESPN response only includes the requesting team's own `roster.entries` and leaves other
  teams' empty, the Trade tab's "You get" column just renders nothing for that team rather than
  breaking (see §4) — that would be the first thing to check if Trade comes up empty.
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
finds your single weakest player there (by **player value** — see `playerValue()`, IR excluded) and
checks whether any available free agent at that position projects higher — one add/drop suggestion
per position, not
a ranked list of everyone worth considering. The Waivers tab's "Top available" section below that
is the full browsable pool if the one-line suggestion isn't the move you want.

**Why `playerValue()` and not just this week's projection:** the first version of this used raw
projected points to find the "weakest" rostered player, which meant a rostered star who's simply
OUT for a single week (projection: 0) looked like the worst player on the team *every week he was
hurt* — indistinguishable from an actually bad player, and confidently suggested as a drop candidate
against literally any healthy waiver-wire body. `playerValue()` fixes this by preferring a player's
recent scoring average (`recentActual`, already computed for the My Team trend display) over a
single week's projection, falling back to the projection only when there's no game history yet (a
new pickup with nothing to average). A temporarily-injured performer with a strong recent average
no longer gets flagged just because this week reads zero; a rostered player whose recent form is
itself weak still correctly does. The AI game plan's system prompt (§5) carries the same rule as a
second line of defense, in case a future change to the offline heuristic reintroduces this failure
mode — it's explicitly told never to endorse a drop suggestion caused by a single-week absence
rather than genuine recent-form weakness. `trade.js` (§4) uses the same function for the same
reason — a trade target shouldn't look worthless just because he's on a bye the week you're
evaluating the trade.

`render/outlook.js` covers the other direction — not swapping players now, but planning a week
ahead: it lists your next few scheduled opponents (sliced straight out of the same `schedule[]`
array the current matchup uses) and flags any rostered player (IR excluded) whose bye week has
arrived or is coming up, so a bye doesn't surprise you the morning lineups lock.

## 4. Trade builder / evaluator

`render/trade.js` covers both directions the name implies: building a package to offer another
team, or plugging in a trade someone offered you to check whether it's fair — mechanically identical,
just which side you tick boxes on first. Pick a trade partner from the other teams in the league
(§2 — this needs every team's roster in the fetched payload, not just yours), check players on your
side ("You give") and theirs ("You get"), and `trade.js: evaluateTrade()` compares both sides by
`playerValue()` (§3) — recent scoring average, not a single week's projection, so a trade target on
a bye this week doesn't look like a throw-in. A delta inside ±2 points/game is called "roughly
even" rather than forcing a winner on a close deal; outside that band it says who it favors. An
uneven player count (e.g. 2-for-1) gets a note, since roster-spot cost isn't captured by point value
alone.

**League-wide trade suggestions** (`trade.js: findLeagueTradeSuggestions()`) run automatically at
the top of the tab, before you've picked a partner — a proactive scan of every other team's roster
for a 1-for-1 swap that would improve *both* starting lineups, not just a fair value trade. The
model: group each team's non-IR players by default position, sorted by `playerValue()`; a position's
"starter floor" is the value of its worst starter under a standard league's starting lineup
(`STANDARD_STARTER_COUNTS`: QB 1, RB 2, WR 2, TE 1, D/ST 1, K 1 — FLEX is deliberately not modeled,
since that needs this league's actual roster/slot settings, which aren't fetched; see the
simplification note in `trade.js`), and anyone beyond that count is "surplus" — bench depth available
to trade without touching your own starting lineup. A candidate trade only surfaces when your spare
at some position would exceed the other team's starter floor there (so it would actually start for
them) *and* their spare at some other position would exceed your own starter floor (so it would
actually start for you) — candidates are ranked by combined improvement to both starting lineups,
deduplicated, and the top few shown with a "Build this" button that loads the exact partner/give/
receive into the manual builder below, so you can tweak it or run the AI analysis on it like any
other trade you built by hand. This is a need-fit signal, not a value-fairness one — a suggested
trade can show "Favors you" or "Favors them" once loaded into the builder below (which compares raw
value) even though the suggestion engine only cared whether it helps both lineups; that's expected,
not a contradiction — they're answering different questions.

Selection state (`trade.js`'s module-level `state` object — partner, give set, receive set) lives
outside React-less render functions the same way `myTeam.js`'s AI cache does: it survives switching
tabs away and back within a session, but isn't tied to the `league` object, so it persists across a
refresh too (rebuilding the same offer shouldn't need re-picking every player after every data
pull). Changing trade partner clears both selections, since a pick belongs to a specific roster.

**AI trade analysis** (`report/aiTrade.js`, optional, same BYOK contract as §5) goes beyond the
value comparison: it's given both teams' *full* current rosters (not just the traded players) so it
can reason about roster construction after the trade — does either side end up thin at a position,
bye-week stacking, injury-risk concentration — the kind of context a bare point-total comparison
can't see. Same rule as the AI game plan: never call a player droppable/worthless for being
OUT/QUESTIONABLE/bye this single week without checking his recent-form average first. The result is
cached per exact selection (a JSON key of partner + give + receive, not a `WeakMap` on the league
object like `myTeam.js`, since the same league fetch can back many different trade ideas in one
sitting) so re-rendering after toggling a checkbox doesn't wipe out an unrelated prior analysis
until the selection actually changes.

## 5. AI game plan (optional, bring-your-own-key)

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

`components/aiSettingsPanel.js` renders the whole settings block (the explanation paragraph,
enable checkbox, key/model fields) inside a native `<details>`/`<summary>` rather than always-open
markup, since on a phone screen the full explanation text competes with the roster for space every
time you open My Team. It defaults open the first time (nothing saved yet, so the setup
explanation shouldn't be hidden behind a tap) and defaults collapsed once a key is already saved
(`config.enabled && config.apiKey`), showing "— configured" in the summary line so it's still
obvious AI is on without expanding it. This is pure presentation — the enable/save/test logic
underneath is unchanged.

### 5c. Perplexity live research on trades and waivers (optional, bring-your-own-key)

`report/research/perplexity.js` sends the same computed summaries to Perplexity's Sonar models,
which search the live web on every request, and returns cited sources alongside the answer. Two
uses: a **trade second opinion** (same prompt, JSON shape, grades and card as Grok's, shared via
`research/prompts.js` and `research/normalize.js`; `components/researchCards.js` renders either provider),
and a **waiver check** on the Waivers tab. The waiver summary is the roster (with season logs),
the computed add/drop suggestions, and the top five free agents per position. For each
suggestion it returns news on both the add and the drop, a go / wait / skip verdict, an A+ to F
grade for the move, and "other pickups" limited to names from the free-agent list sent (so it
cannot invent players). The prompt repeats the rule against dropping a good player over a
one-week injury. Config is separate (`perplexityConfig.js`, `components/perplexitySettingsPanel.js`,
`localStorage['huddle:perplexity-config:v1']`, default model `sonar-pro`). Sources are filtered to
`http(s)` through `utils.js: sourceLinksHtml()` and `<think>` blocks are stripped from reasoning
models' replies. The waiver result is cached per fetched `league` object like the AI game plan.

**Unverified:** like §5b this was written without access to Perplexity's docs or API. The
endpoint (`POST https://api.perplexity.ai/chat/completions`, Bearer auth), the `sonar-pro` model
name, the `citations` / `search_results` response fields, and whether browsers may call the API
directly (CORS) are all from memory. JSON is requested in the prompt rather than via
`response_format`. Test connection and Perplexity's own error text show what is wrong; each
should be a one-line fix in that file.

### 5d. One section for the other AI views, and a final analysis

Every decision surface now works the same way. **Claude** stays the primary view (My Team: the game
plan; Waivers: a new Claude waiver check, `aiWaiver.js`, which judges the computed moves from the
data alone; Trade: the trade analysis). Under it, `components/aiViews.js` renders a collapsible
**Other AI views** section (a native `<details>`, collapsed until something is run) with a Run
button per configured provider and a Run all, and each provider's result in its own nested
dropdown. Grok and Perplexity run through one shared layer (`report/research/`): a prompt and a
parser per decision type (`trade`, `waiver`, `lineup`), so a new surface or provider is a small
addition. Their results share a shape per decision type (`{ data, rawText, sources }`), which is
also what lets the views be compared. If a reply isn't parseable JSON the card shows the raw text.

The last step is **Compare all AI views** (`aiSynthesis.js`): Claude is given every view that has
been run for that decision plus a short brief (e.g. the exact trade and the offline grades), told
which analysts used live search and which worked only from the computed data, and returns common
themes (and who agreed), key differences (each side's position and how to resolve it), a final
recommendation, a confidence level, and open questions to check. It needs a Claude key and at
least two views. Its prompt tells it not to invent a consensus when the analysts split and not to add
facts that are not in the inputs. Because the same results back both the cards and the
comparison, the comparison is marked stale ("views changed since the last comparison") if any view
is re-run afterward.

Results live in a `WeakMap` keyed by the fetched `league` object and then by decision (the exact
trade selection, or `lineup` / `waiver`), so tab switches and re-renders keep them, switching to a
different trade starts clean, and a refresh drops everything next to the new numbers. Nothing is
persisted. What gets sent: the other views' structured results and the short brief go to Anthropic
for the comparison; the footer says so.

### Trade grades (A+ to F)

Every trade shows a grade for each side. The always-on one is computed offline in `trade.js:
gradeForDelta()` from the same value gap `evaluateTrade()` already uses: net points per game
gained, mapped to 13 letter grades centered on C+ (a straight wash). It is symmetric (an A+ for
you is an F for them) and its third cutoff is the same 2-point band as the "even" verdict, so a
roughly-even trade never grades past B or down past C-. It is value only, so the card says it
ignores positional need. The Claude and Grok analyses each return their own `yourGrade` and
`theirGrade` that also weigh roster fit, injuries and byes; those are model judgments, shown
separately and not blended with the offline grade.

### 5b. Grok second opinion on trades (optional, bring-your-own-key)

`report/research/grok.js` sends the same trade summary as `aiTrade.js` to xAI's Grok, which unlike
the Claude call can search the live web and X. It returns per-player latest news (with a
confirmed / reported / rumor / no-news confidence tag), prior-season and career history, reasoning,
risks, and, when a Claude analysis already exists for the same selection, written feedback on it
(`claudeAnalysis` is added to the summary only in that case). Its key and model live separately
in `localStorage['huddle:grok-config:v1']` (`grokConfig.js`, `components/grokSettingsPanel.js`),
so either provider can be set up or removed on its own. Rendered sources are filtered to
`http(s)` URLs, and every model-written field goes through `escapeHtml`.

**Historic performance** comes from two places, deliberately labeled differently in the UI.
In-season weekly points (`seasonLog`, every completed week, derived from the same `stats` array
as `recentActual`, no extra ESPN request) are shown in each trade row and sent to both models.
Prior seasons are not fetched from ESPN at all (that needs a different, even less documented
request); Grok recalls them, and the card says "recalled, not from ESPN" so they aren't mistaken
for the league's own data.

**Unverified:** this was written without live access to xAI's docs or API (their docs host is
blocked from the build sandbox). The request is a `POST https://api.x.ai/v1/responses` with
`tools: [web_search, x_search]` and Bearer auth, the default model is `grok-4`, and the reply
parser accepts the Responses API `output[].content[].text` shape plus a few fallbacks. The model
is asked for JSON in the prompt rather than via a strict schema, because it is unknown whether
a schema can be combined with the search tools; if the reply isn't parseable JSON the card shows
the raw text instead. Whether `api.x.ai` permits direct browser calls (CORS) is also untested.
The Test connection button and xAI's own error text (shown on failure) are the way to find out;
a wrong tool name, model name, or blocked CORS should each be a one-line fix in `research/grok.js`
or the model field.

## 6. Local persistence, no account

League config (Worker URL, league ID, year, team ID, and — for private leagues — SWID/espn_s2)
lives in `localStorage['huddle:config:v1']`, never anywhere else. The last successfully fetched
league snapshot (including the free-agent pool) is cached in `localStorage['huddle:cache:v6']`
purely so reopening the app on a spotty phone connection shows *something* instantly (with a
"showing cached data" note) while a fresh fetch runs in the background — same pattern as Pulse's
`reportCache.js`. (Bumped `v1` → `v2` when the free-agent/bye-week/outlook fields were added, then
`v2` → `v3` when every team's roster was added for Trade, `v3` → `v4` when the full-season weekly
`seasonLog` was added to every player, `v4` → `v5` when per-week stats were restricted to single-week
entries (below), `v5` → `v6` when full-season history was added (below) — each bump is just a cache key, so
nothing needed migrating, the old entry is simply never read.)

SWID/espn_s2 cookies are ESPN's own session cookies, not a Huddle-issued credential — they expire
periodically (weeks to months), at which point requests to a private league start failing and
they need refreshing from a logged-in `fantasy.espn.com` browser session (Settings → the two
private-league fields).

## 7. Cache-busting

Same manual-versioning approach as the rest of the site (see Pulse's ARCHITECTURE.md §8) — bump
`?v=N` on `css/style.css`'s `<link>` in `index.html` any time the stylesheet changes.

JavaScript is versioned too, via an import map in `index.html` that maps every `js/` module URL to
the same URL with `?v=N`, plus `?v=N` on the entry `<script>`. Without it a browser (iPhone
Safari in particular) can keep serving an old copy of one module after a deploy while others are
new, which showed up as a missing Grok panel. **Whenever any file in `js/` changes, bump N on the
import map lines and the entry script** (`sed -i 's/?v=7/?v=8/g' index.html` also bumps the CSS
link, which is fine). A new module file needs a line in the map; one missing from the map still
works, it is just not versioned. Browsers without import-map support (before Safari 16.4) ignore
it and behave as before.

### Per-week stats

ESPN's `stats` array on a player holds single-week entries (`statSplitTypeId` 1) alongside
season-total and rolling-window entries whose `appliedTotal` is a sum over many games. Reading
them all as weekly points produced a "last 3" of `130.4, 319.5, 22.6` for a quarterback, which
also skewed `playerValue()`, waiver picks, trade values and grades. `espnClient.js: weeklyOnly()`
now keeps only split id 1 whenever the field is present at all. Assumption to confirm against a
real league: that id 1 is the single-week split (from community reverse engineering, not ESPN
docs). If the "last 3" line goes blank instead of wrong, that assumption is the thing to fix.

### Season history (`history.js`)

After single-week filtering, a real league showed only about one weekly score per player ("last 1:
22.6"), so ESPN's current-week roster payload clearly carries only a week or two of weekly stats.
`history.js` rebuilds the season log by asking the same roster endpoint for each completed week
(`fetchRosterForWeek`: `view=mRoster&scoringPeriodId=N`, which the Worker already forwards, so no
Worker redeploy) and reading each player's points for that week out of the response: the weekly
`stats` entry if present, otherwise `playerPoolEntry.appliedStatTotal`. Requests run three at a
time, after the first render, so the app is usable immediately and the My Team/Trade/Waivers data
fills in a moment later (skipped re-render if an input is focused). Completed weeks never change,
so each is cached once in `localStorage['huddle:history:v1:<league>:<year>']`; later refreshes make
no history requests, and a week that failed or had nothing readable is simply retried next time.
`applyHistory()` then rebuilds `seasonLog` and `recentActual` (last 3) on every rostered player and
free agent, keeping any weekly points the original payload had for weeks the history lacks.

Two judgment calls to know about: an exact 0 is treated as "did not play" (injury, bye, inactive) and
left out so a bye week or a one-week injury can't drag a player's recent average down (a true 0.0
game is rare enough to accept losing); and any value over 100 points is discarded as a misread.
**Unverified against a real league:** that ESPN returns each player's points for the requested week
in one of those two fields in this response. A player who wasn't on any roster that week (a free
agent, or someone picked up since) has no entry for it, so free agents in particular keep a thin
log. If real history comes back empty the app just behaves as it did before this change.

