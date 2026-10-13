# Pulse — Wearable Health Analyst — Architecture

Pulse is a client-only, zero-build-step web app (vanilla HTML/CSS/JS, ES modules) that turns a
wearable data export — Oura, Whoop, Garmin, Fitbit, or any tracker's CSV/JSON export — into a
data-grounded baseline profile, pattern analysis, and prioritized list of leverage points.

Everything runs in the browser by default. There is no backend for the core app, no auth, and no
build tool. File parsing and every statistical calculation (baselines, trends, correlations,
elevation events) happen locally — the raw file never leaves the machine unless the optional AI
assistance feature is turned on, and even then only a computed JSON summary is sent, never the raw
per-day rows. The one exception is also optional: "Connect Whoop" (§9) talks to a small, stateless
relay service, because Whoop's OAuth2 flow has a hard requirement the rest of this app's
architecture doesn't — see that section for why and what it actually does.

## 1. File layout

```
pulse/
  index.html                    Page shell: dark hero + upload UI, AI settings, #vitals-strip + #report-root
  oauth-callback.html            Whoop OAuth redirect target — completes the connection, then returns here
  css/style.css                  Design system: dark ink / white paper tokens, Sora + Plus Jakarta Sans +
                                   JetBrains Mono, card+shadow components — see §6
  js/
    stats.js                      Dependency-free math: mean/stddev/percentile/linreg/correlation,
                                    plus circular-safe bedtime-hour handling
    utils.js                       escapeHtml, date formatting, FileReader wrapper
    aiConfig.js                    localStorage read/write for the optional bring-your-own-key AI settings
    aiVerify.js                    "Test connection" — smallest possible live API call
    reportCache.js                  localStorage read/write for the last computed report (local-only persistence)
    whoopAuth.js                    Whoop OAuth: authorize-URL + CSRF state, token storage, auto-refresh — see §9
    app.js                         Wires upload/Whoop-sync -> parse -> analyze -> render, and the AI report button
    components/
      aiSettingsPanel.js            Shared enable/key/model UI (same contract as Iceberg's)
    parsers/
      csv.js                          Hand-rolled RFC-4180-ish CSV parser (quoted fields, no dependency)
      fieldMapper.js                  Header-name heuristics: raw column -> canonical metric field
      fileParser.js                    Dispatches CSV/JSON, normalizes rows, merges multiple files by date
      whoopApi.js                      Live Whoop API fetch + field mapping onto the same canonical shape — see §9
    analysis/
      metricCatalog.js                 Canonical field labels/units/categories — single source of truth
      inventory.js                      Step 1: file recognition, categories present, date range, gaps, completeness
      baselines.js                      Step 2: per-metric averages, RHR by weekday, sleep architecture %
      patterns.js                       Step 3: trends, variances, elevation events, cross-metric correlations
    report/
      renderReport.js                   Renders Data Summary / Baseline Profile / Pattern Analysis as HTML
      renderVitals.js                    The dark "vitals strip": a Whoop-style recovery ring + secondary tiles
      aiReport.js                       Optional BYOK call: computed summary -> Top 5 Leverage Points + Weekly Protocol

whoop-relay/                      A separate deployable (Cloudflare Worker) — not part of the static site.
  worker.js                         The entire relay: token exchange, token refresh, API passthrough. See §9.
  wrangler.toml                     CLI deploy config
  README.md                         Deployment steps (dashboard and CLI paths)
```

Data flow is strictly one-directional and each layer only talks to the layer below it:

```
app.js -> parsers/*.js -> analysis/*.js -> report/renderReport.js -> DOM
                                         -> report/aiReport.js (optional, BYOK)
```

## 2. Why "canonical fields" instead of per-vendor parsers

Real exports vary wildly in column naming (Oura's "Sleep Score" vs. Whoop's "Sleep performance %"
vs. a hand-rolled "sleep_score"), but the *shape* of the data — one row per day, with metric
columns — is consistent enough across CSV and JSON exports to unify with header-name heuristics
instead of writing and maintaining five separate vendor parsers.

`fieldMapper.js` holds an ordered list of regex patterns tested against a normalized version of
each header (lowercased, non-alphanumeric collapsed to `_`). The first match wins per column. Any
column that matches nothing is simply ignored — Pulse never assumes a metric exists just because
the catalog knows about it (see `metricCatalog.js`), matching the "only analyse what's actually in
the file" rule the whole app follows.

`fileParser.js` calls `parseCsv()` or does a light JSON flatten (one level of nesting, e.g. Oura's
`contributors.temperature` -> `contributors_temperature`) to get `{ headers, rows }`, then
`fieldMapper.js: normalizeRows()` turns that into `[{ date, sleepTotalMin, hrv, ... }]`. Multiple
uploaded files are merged into one array (one record per calendar date, outer join) by
`mergeParsedFiles()`.

**Known gap:** XML exports (e.g. Apple Health's `export.xml`) are explicitly rejected with a
message asking for a CSV/JSON export instead — XML health exports are typically enormous
(hundreds of thousands of fine-grained samples) and need a fundamentally different, streaming
parser to handle in-browser without freezing the tab. Out of scope for v1.

### 2a. Event-level exports (validated against a real Whoop data export)

Not every export is one row per day. Whoop's bundle is a good stress test because it's four
files with three different shapes:

- `physiological_cycles.csv` — one row per day (mostly): recovery, RHR, HRV, skin temp, strain,
  sleep stages. The normal case `fieldMapper.js` was designed around.
- `sleeps.csv` — one row per *sleep*, including naps, flagged by a `Nap` column. `fileParser.js`
  drops nap rows before mapping (a 20-minute nap has no business being averaged into, or
  overwriting, that night's real sleep numbers) via a generic "does any header normalize to
  `nap`" check, not a Whoop-specific one.
- `workouts.csv` — one row per *workout*, several per day on a hard training day.
- `journal_entries.csv` — "long" format: one row per (day, yes/no habit question) pair, e.g.
  `"Have any alcoholic drinks?", "true"`. This doesn't fit the one-column-per-metric model at
  all — the behavior name is in a cell value, not a header — so `fieldMapper.js:
  parseJournalRows()` detects the `Question text` / `Answered yes` shape and pivots it: each
  matched row becomes its own `{ date, alcoholTag: true }`-style micro-record, keyed off the same
  `TAG_KEYWORDS` used to build the eventual behavioral-correlation section.

Two general-purpose mechanisms make this work without hardcoding Whoop's file names:

1. **`fileParser.js: aggregateByDate()`** folds multiple same-date rows from one file into a
   single per-day record before that file's data reaches `mergeParsedFiles()`. Fields where two
   rows really do represent two separate events (`workoutMinutes`, `activeCalories`,
   `totalCalories`, `steps`, `disturbances` — see `ADDITIVE_FIELDS`) are summed; everything else
   (a score, a rate, a percentage) is averaged, since two same-day values for those are two
   readings of the same thing, not two things to add. Boolean tags OR together. A same-date group
   that included any row with `workoutMinutes` also gets a computed `workoutCount`.
2. **`mergeParsedFiles()` takes the max, not the last write, for `ADDITIVE_FIELDS`** when two
   *different* files both report a value for the same date. A day-summary file's whole-day
   calories and a workout-log file's per-workout calories are both real numbers at very different
   scales; blindly letting whichever file the browser lists last win could silently replace the
   larger, complete figure with a small partial one. Taking the max is a cheap, generally-correct
   way to prefer the more complete source without knowing which file that is.

**Known limitation:** cross-file precedence for *non*-additive fields (a score, a rate) is still
simple last-file-wins — there's no generic way to know which of two sources is more authoritative
for those without device-specific knowledge, and getting it wrong is lower-stakes (the two numbers
are usually close, not off by 5x like calories can be).

### 2b. Absolute readings vs. device-reported deviations

Oura reports body temperature as a deviation from *your own* rolling baseline (0.0 = normal for
you). Whoop and some Garmin devices report an absolute skin temperature instead (e.g. 34.5°C),
which has no built-in "normal" to compare against. Mapping both onto one canonical field would
either misinterpret an absolute 34.5°C reading as +34.5° above baseline (setting off every
elevation flag, every night) or need the renderer to guess which kind of number it's looking at.

Instead `fieldMapper.js` keeps them as two separate canonical fields — `tempDeviation` (device-
reported) and `skinTempC` (absolute) — and `analysis/patterns.js` §3D computes a "deviation" for
the absolute case itself: each night's `skinTempC` minus that person's own dataset average. The
same downstream logic (stddev, the +0.5° elevation threshold, consecutive-night run detection)
then runs identically either way; `renderReport.js` just adds one sentence noting when a
"baseline" is self-computed rather than device-provided, so nobody reads a Whoop user's
temperature section as more clinically calibrated than it is.

## 3. Analysis engine (fully offline)

`analysis/inventory.js`, `baselines.js`, and `patterns.js` implement Steps 1-3 of the analysis
brief as pure functions over the normalized records — no AI call involved. Every number shown in
the Data Summary, Baseline Profile, and Pattern Analysis sections is computed with the helpers in
`stats.js` (mean, stddev, linear-regression slope for trends, Pearson correlation for cross-metric
relationships like "prior-day strain vs. next-day HRV").

A few things worth knowing if you're extending this:

- **Bedtime variance** needs circular-safe math: a 23:45 bedtime and a 00:15 bedtime are 30 minutes
  apart, not ~23.5 hours apart. `stats.js: shiftEveningHour()` re-anchors the scale to 18:00 = 0 so
  typical bedtimes (evening through early morning) form one contiguous range instead of wrapping
  around midnight.
- **Correlations use date-based joins, not array-index joins.** `patterns.js: pairedShift()` looks
  up `date + N days` in a `Map`, so it's correct even when the dataset has gaps (missing days don't
  silently shift every later pairing by one).
- **Elevation events** (RHR, temperature) use a fixed threshold matching the analysis brief exactly
  (RHR: baseline + 5 bpm; temperature: +0.5°), not a statistical outlier test — this is
  intentionally interpretable over "more correct" but opaque.
- Every pattern sub-section is optional and simply omitted from the returned object if the
  underlying field(s) aren't present or there isn't enough data (a floor of ~4 data points for
  correlations/trends) — `renderReport.js` and the eventual AI prompt both treat "missing key" as
  "don't mention this," never as "assume zero."

## 4. AI assistance (optional, bring-your-own-key)

Steps 1-3 (inventory, baselines, patterns) are pure arithmetic and run fully offline. Step 4 (rank
the 5 most impactful, fixable leverage points) and Step 5 (synthesize a weekly protocol) require
judgment and prioritization that a fixed set of `if` statements can't do well — so those two
sections are optionally generated by calling the Anthropic API directly from the browser with a
user-supplied key, same BYOK pattern as Iceberg's AI features (`aiConfig.js` / `aiVerify.js` /
`components/aiSettingsPanel.js` are near-identical ports).

`report/aiReport.js` sends only the *computed* `{ inventory, baselines, patterns }` JSON — never
the raw uploaded file — as the user message, with a system prompt instructing the model to ground
every leverage point in the numbers actually present in that summary, and uses
`output_config.format: { type: 'json_schema', ... }` (structured outputs) so the response is
guaranteed valid JSON matching the leverage-points/protocol schema, no markdown-fence stripping.

If AI assistance is off (the default), the report still shows the full offline analysis; the
leverage-points/protocol section is replaced with a note explaining why it's empty and how to turn
AI on.

## 5. Expanding metric coverage

To recognize a new metric:
1. Add it to `metricCatalog.js: METRICS` (label, unit, category).
2. Add one or more header-matching patterns to `fieldMapper.js: PATTERNS`.
3. If it needs custom parsing (not a plain number — e.g. a time-of-day or boolean tag like the
   existing `bedtime`/`alcoholTag` handling), add it to the relevant `Set` near the bottom of
   `fieldMapper.js` and handle it in `normalizeRows()`.

Everything downstream (inventory completeness, baseline averages, and — if you also add pattern
logic — pattern analysis) picks it up automatically once it's flowing through as a canonical field.

## 6. Design system

The visual language is a deliberate cross of three references: Spotify's dark, immersive "now
playing"-style data bands; Airbnb's warm, elevated white content cards; and Whoop's circular
recovery-ring readout. Concretely:

- **Two surfaces, not one theme.** `--ink`/`--ink-raised`/`--ink-border` (near-black) drive the
  header, hero, footer, and the vitals strip — anywhere the page is showing a glanceable summary
  rather than dense content. `--paper`/`--paper-raised` (true white) plus the same subtle
  border+shadow combo drive everything else. Both are declared once in `css/style.css:root` —
  there's no dark-mode toggle, just two fixed zones by design intent.
- **Every top-level report section is a card — not just the special ones.** `.report-section`
  itself carries the white-card treatment (border, radius, shadow, padding), so Data Summary,
  Baseline Profile, and Pattern Analysis read as the same elevated surface as the upload card and
  the AI settings panel, instead of the generic sections looking like plain document text next to
  a few hand-styled components. The one deliberate exception is CSS-only:
  `.report-section:has(.leverage-card)` strips that outer card back off for the leverage-points
  section, because it already renders one accent-striped card per point — an outer card there
  would just be a card wrapped around cards.
- **One accent color, used consistently.** `--accent` (steel blue) marks anything interactive or
  emphasized — the ring, buttons, section eyebrows, the leverage-card accent stripe — never
  decoratively. `--accent2` exists only for a second data series inside a chart (there isn't one
  yet in the shipped report, but `renderVitals.js`'s CSS leaves room for it).
- **Three type roles**: Sora (bold, display — headings, the wordmark) / Plus Jakarta Sans (body
  text) / JetBrains Mono (anything numeric — see the `.num` utility class, which also sets
  `font-variant-numeric: tabular-nums` so columns of figures actually line up). Loaded from Google
  Fonts in `index.html`'s `<head>`; there's no CSP restriction to work around here the way there
  was in the Claude Artifact mockup preview — this is a normal GitHub Pages site.
- **`renderVitals.js`** is the one place the Whoop reference shows up structurally rather than just
  stylistically: it looks for `recoveryScore` first, falling back to `sleepEfficiencyPct`, as the
  ring's headline number (both are naturally 0-100, unlike RHR or HRV), and renders nothing at all
  — not an empty ring — when neither is present in the uploaded data. The ring's SVG
  `stroke-dasharray`/`stroke-dashoffset` are computed from the real baseline average, not
  hardcoded, so it reflects whatever the person actually uploaded.

This design work started as a Claude Design canvas mockup (two static `.dc.html` artboards
exploring the direction) before being ported into the real app; the mockup is not kept in this
repo, since it was a disposable exploration step, not a second implementation to maintain.

## 7. Local persistence (not cloud sync)

Pulse never stored the uploaded file itself — it's read in memory, analyzed, and discarded — but
until this point the *computed report* was fully ephemeral too: reloading the tab meant re-
uploading. `reportCache.js` fixes that by saving the computed `{ inventory, baselines, patterns,
aiReport? }` object (never the raw per-day records, and never the file) to
`localStorage['pulse:last-summary:v1']`, and `app.js` restores it on load, showing a small
"Showing your last analysis, saved in this browser" banner with a `Clear` button
(`clearCachedSummary()`).

This is **local-only** — there is deliberately no cross-device sync. That was a real option on the
table (either a bring-your-own-key GitHub Gist sync, matching the app's existing BYOK pattern for
AI, or a real backend like Supabase/Firebase), but both would have meant either a new account
requirement or a new third-party service holding synced health data, which is a materially
different privacy posture than "nothing leaves your browser" — worth deciding deliberately with
the site owner rather than defaulting into. localStorage keeps that promise intact (the data still
never leaves the device) while fixing the actual annoyance (losing your report on a reload).
Reintroducing real sync later is a separate, self-contained decision — `reportCache.js`'s
`loadCachedSummary`/`saveCachedSummary` contract wouldn't need to change, only what calls them.

## 8. Cache-busting

There's no build step generating hashed filenames, so `index.html` links `css/style.css` with a
manual `?v=N` query string. A visual redesign shipped once with an unversioned link and some
visitors kept seeing the old stylesheet indefinitely (their browser had a cached copy of the exact
same URL from before the deploy, and nothing about that URL changed to tell it otherwise) — the
HTML itself updated fine, since GitHub Pages doesn't cache as aggressively as browsers do, but
`css/style.css` didn't. **Bump `?v=N` in both `index.html` and `oauth-callback.html` any time
`css/style.css` changes** — it costs one line each and guarantees every visitor gets the new one
instead of hoping their cache expires on its own.

## 9. Connecting Whoop directly (OAuth) — and the one place this isn't 100% client-side

Manual CSV/JSON upload (§2) works for any device and needs nothing beyond the browser. "Connect
Whoop" is an added, optional second path for Whoop users specifically: authorize once, then pull
fresh data on demand instead of re-exporting a file each time. It's additive — uploading a file
still works exactly as before, connected or not — and it's the one feature in this app that isn't
fully self-contained in the browser, for a reason worth being explicit about.

**Why it needs a server at all.** Whoop's OAuth2 token exchange requires `client_secret_post`
authentication — the client secret has to be presented alongside the client ID when trading an
authorization code for tokens. There's no documented PKCE / public-client option that would let a
pure static site do this safely. A secret embedded in this repo's client-side JS would be visible
to anyone who views source on a public GitHub Pages site — not a secret at all. So a tiny piece of
this feature necessarily lives outside the browser.

**How small "necessarily" turns out to be.** `whoop-relay/worker.js` is a stateless Cloudflare
Worker with exactly three jobs, each a thin passthrough to Whoop's own API:

- `POST /token` — exchanges an authorization code for tokens (the step that needs the secret)
- `POST /refresh` — exchanges a refresh token for a new access/refresh pair (same reason)
- `GET /proxy/*` — forwards an already-authenticated request to Whoop's data API, passing the
  caller's own `Authorization` header through unchanged (this one doesn't strictly need the
  secret — it exists because Whoop's CORS policy for browser-direct calls isn't documented either
  way, and proxying through something that can set its own CORS headers sidesteps the question
  entirely rather than hoping it works)

It holds no database, no KV namespace, no user accounts — nothing persists there between requests.
The actual Whoop access and refresh tokens are generated by Whoop and stored only in the browser's
`localStorage` (`pulse:whoop-auth:v1`, read/written exclusively by `whoopAuth.js`), the same pattern
`aiConfig.js` already uses for the Anthropic key. The Worker sees a token pass through once per
exchange and keeps nothing.

**The flow, end to end:**

1. `whoopAuth.js: startConnect()` builds Whoop's authorize URL (client ID — not secret, meant to be
   public — redirect URI, scopes, a fresh CSRF `state` stashed in `sessionStorage`) and redirects
   the browser to Whoop's consent screen.
2. Whoop redirects back to `oauth-callback.html` with `?code=...&state=...`. That page calls
   `whoopAuth.js: completeConnect()`, which checks `state` against what was stashed (rejecting a
   mismatch rather than trusting an arbitrary redirect), then POSTs the code to the relay's
   `/token` endpoint and stores what comes back.
3. Back on the main page, `app.js` sees `?whoop=connected` in the URL, cleans it up, and immediately
   calls `whoopApi.js: fetchWhoopData()` rather than making the user click Sync a second time.
4. `fetchWhoopData()` pages through the relay's `/proxy/cycle`, `/proxy/recovery`,
   `/proxy/activity/sleep`, and `/proxy/activity/workout`, maps each response onto Pulse's existing
   canonical record shape (the same `{ date, rhr, hrv, sleepTotalMin, ... }` shape `fieldMapper.js`
   produces from a CSV), and hands the result to the exact same
   `mergeParsedFiles` → `buildInventory`/`buildBaselines`/`buildPatterns` pipeline a file upload
   goes through. From that point on, a Whoop API connection and a CSV upload are indistinguishable
   to the rest of the app.
5. `whoopAuth.js: getValidAccessToken()` is called before every data request; if the stored access
   token is expired (or about to be), it transparently calls the relay's `/refresh` first. Whoop
   **rotates** refresh tokens — each refresh invalidates the previous one — so the newly-returned
   refresh token is re-saved every time, not just the access token. A failed refresh clears the
   stored connection rather than leaving a silently-broken "connected" state on screen.

**A real, flagged limitation: the field mapping is unverified against a live response.** Whoop's
developer documentation wasn't reachable from the environment this was built in (blocked by
network policy), so `whoopApi.js`'s mapping — which JSON fields become `recoveryScore`, `hrv`,
`sleepTotalMin`, and so on — is a best-effort reconstruction from secondary sources and general
knowledge of the API, not something fetched and checked against a real account. It's covered by
unit tests against *synthetic* responses shaped the way the mapper expects, which proves the
conversion math and pagination logic are internally correct, but proves nothing about whether
Whoop's actual response matches that shape. `safeMap()` in that file is the deliberate hedge: a
record that doesn't match what's expected is skipped and counted (surfaced as a warning in the UI)
rather than silently coerced into a plausible-looking but wrong number — important for a health
app specifically, where a wrong number that looks reasonable is worse than a visibly missing one.
The real test is the first live connection in Whoop's Sandbox tier (see `whoop-relay/README.md`);
any mismatch found there is a mapping fix, not a sign the overall design is wrong.
