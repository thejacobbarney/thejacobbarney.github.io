# Pulse — Wearable Health Analyst — Architecture

Pulse is a client-only, zero-build-step web app (vanilla HTML/CSS/JS, ES modules) that turns a
wearable data export — Oura, Whoop, Garmin, Fitbit, or any tracker's CSV/JSON export — into a
data-grounded baseline profile, pattern analysis, and prioritized list of leverage points.

Everything runs in the browser. There is no backend, no auth, and no build tool. File parsing and
every statistical calculation (baselines, trends, correlations, elevation events) happen locally —
the raw file never leaves the machine unless the optional AI assistance feature is turned on, and
even then only a computed JSON summary is sent, never the raw per-day rows.

## 1. File layout

```
pulse/
  index.html                    Page shell: dark hero + upload UI, AI settings, #vitals-strip + #report-root
  css/style.css                  Design system: dark ink / white paper tokens, Sora + Plus Jakarta Sans +
                                   JetBrains Mono, card+shadow components — see §7
  js/
    stats.js                      Dependency-free math: mean/stddev/percentile/linreg/correlation,
                                    plus circular-safe bedtime-hour handling
    utils.js                       escapeHtml, date formatting, FileReader wrapper
    aiConfig.js                    localStorage read/write for the optional bring-your-own-key AI settings
    aiVerify.js                    "Test connection" — smallest possible live API call
    reportCache.js                  localStorage read/write for the last computed report (local-only persistence)
    app.js                         Wires upload -> parse -> analyze -> render, and the AI report button
    components/
      aiSettingsPanel.js            Shared enable/key/model UI (same contract as Iceberg's)
    parsers/
      csv.js                          Hand-rolled RFC-4180-ish CSV parser (quoted fields, no dependency)
      fieldMapper.js                  Header-name heuristics: raw column -> canonical metric field
      fileParser.js                    Dispatches CSV/JSON, normalizes rows, merges multiple files by date
    analysis/
      metricCatalog.js                 Canonical field labels/units/categories — single source of truth
      inventory.js                      Step 1: file recognition, categories present, date range, gaps, completeness
      baselines.js                      Step 2: per-metric averages, RHR by weekday, sleep architecture %
      patterns.js                       Step 3: trends, variances, elevation events, cross-metric correlations
    report/
      renderReport.js                   Renders Data Summary / Baseline Profile / Pattern Analysis as HTML
      renderVitals.js                    The dark "vitals strip": a Whoop-style recovery ring + secondary tiles
      aiReport.js                       Optional BYOK call: computed summary -> Top 5 Leverage Points + Weekly Protocol
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
  rather than dense content. `--paper`/`--paper-raised` (true white) plus `.card`'s subtle
  border+shadow combo drive everything else (the report tables, leverage-point cards, the AI
  settings panel). Both are declared once in `css/style.css:root` — there's no dark-mode toggle,
  just two fixed zones by design intent.
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
