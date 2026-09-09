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
  index.html                    Page shell: upload UI + AI settings + #report-root
  css/style.css                  Minimal, readability-only styling
  js/
    stats.js                      Dependency-free math: mean/stddev/percentile/linreg/correlation,
                                    plus circular-safe bedtime-hour handling
    utils.js                       escapeHtml, date formatting, FileReader wrapper
    aiConfig.js                    localStorage read/write for the optional bring-your-own-key AI settings
    aiVerify.js                    "Test connection" — smallest possible live API call
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
