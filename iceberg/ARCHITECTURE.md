# Iceberg — Career Journal — Architecture

Iceberg is a client-only, zero-build-step web app (vanilla HTML/CSS/JS, ES modules) that acts as
a living, three-dimensional record of a professional's work history. It goes beyond a static resume
by letting you capture raw experiences as they happen, refine them into impact-focused STAR-style
descriptions later, and match your full history against a specific job description when it's time
to apply or interview.

Everything lives in the browser (`localStorage`). There is no backend, no auth, and no build tool —
this is deliberate: the brief asked for content and structure first, styled and expanded later.

## 1. File layout

```
iceberg/
  index.html              Page shell: header/nav + an empty #view-root the router fills in
  css/style.css            Minimal, readability-only styling
  vendor/                  Self-hosted third-party libraries (see vendor/VERSIONS.md)
    pdfjs/                   PDF text extraction (Apache-2.0)
    mammoth/                 DOCX text extraction (BSD-2-Clause)
  js/
    data-model.js           Entity shapes + factories (Experience, Skill) — the source of truth
    storage.js                localStorage read/write + JSON export/import serialization
    state.js                   In-memory store, CRUD operations, pub/sub — the only module views touch
    utils.js                    IDs, HTML escaping, date formatting, keyword search/matching
    aiConfig.js                  localStorage read/write for the optional bring-your-own-key AI settings
    app.js                       Hash-based router: URL hash → view module
    components/
      aiSettingsPanel.js           Shared enable/key/model UI — every AI-assisted feature reuses this
    parsers/
      textExtraction.js           File → raw text, dispatched by extension (PDF/DOCX/TXT)
      resumeParser.js              Raw text → candidate Experience/Skill records (offline heuristic)
      aiResumeParser.js             Same contract as resumeParser.js, via the Anthropic API (opt-in, BYOK)
      aiRefine.js                    STAR notes → polished description, via the Anthropic API (opt-in, BYOK)
    views/
      dashboard.js               Timeline/list, search + filters
      experienceForm.js           Add/edit form + "Strengthen this experience" (STAR) flow
      skills.js                    Skills & Tools inventory, grouped by category
      match.js                      Paste a job description → ranked relevant experiences
      importResume.js               Upload resume/LinkedIn PDF/DOCX → review → bulk-add
      exportImport.js               Download/restore the full dataset as JSON
```

Each layer only talks to the layer below it:

```
views/*  →  state.js  →  storage.js  →  localStorage
              ↑
         data-model.js (shapes, used by both state.js and views for defaults/constants)
```

No view ever imports `storage.js` or touches `localStorage` directly, and no view mutates data
without going through `state.js`. That boundary is what makes each of the "expandability" paths
below a localized change instead of a rewrite.

## 2. Data model

### Experience / Work Event (`data-model.js: createExperience`)

| Field | Notes |
|---|---|
| `id` | Generated (crypto.randomUUID with a fallback) |
| `title`, `organization` | Short name + optional company |
| `startDate`, `endDate`, `isOngoing` | Date range; leave `endDate` blank for a single-date event |
| `type` | One of `EXPERIENCE_TYPES` (job, project, achievement, process-improvement, leadership, technical-deep-dive, other) |
| `originalDescription` | What was written/remembered at the time — quick capture, never overwritten by refinement |
| `starSituation/Task/Action/Result` | Optional scratch fields for the STAR refinement flow |
| `refinedDescription` | The impact-focused version; assembled from the STAR fields or hand-written |
| `metrics` | Free-text quantifiable results |
| `skillsHard`, `skillsSoft`, `tools`, `tags` | Arrays of strings; each is auto-registered as a Skill record |
| `notes` | Context / lessons learned |
| `linkedToResume` | Boolean flag |
| `source` | `'manual'` or `'imported'` — provenance flag set by the resume-import flow |
| `createdAt`, `updatedAt` | ISO timestamps |

### Skill / Tool (`data-model.js: createSkill`)

| Field | Notes |
|---|---|
| `id`, `name`, `category` | Category is one of `SKILL_CATEGORIES` (technical, soft, domain, tool) |
| `proficiency`, `notes` | Optional free text |

**Relationship:** Skill↔Experience is many-to-many but is *not* stored as a join table. It's
computed on demand by `state.js: getExperiencesForSkill(name)`, which scans every experience's
`skillsHard`/`skillsSoft`/`tools`/`tags` for a case-insensitive name match. This means editing an
experience's tags can never leave a stale relationship behind — there's nothing to keep in sync.

Whenever an experience is saved, `state.js: autoRegisterSkills()` walks its skill/tool fields and
creates a `Skill` record for any name that doesn't already exist (satisfying "auto-extract" from
the brief). The Skills view also allows adding one manually up front.

## 3. Persistence

`storage.js` is the only module that touches `localStorage`, under the key `iceberg:data:v1`. The
whole dataset (`{ version, experiences, skills }`) is read once into memory at startup by
`state.js`, and every mutation immediately re-serializes the whole thing back to storage. For a
personal single-user tool this is simpler and less bug-prone than diffing/patching, and the data
volumes involved (hundreds of experiences at most) make full-document writes cheap.

Export/Import round-trips the same JSON shape, so a backup file can be re-imported without any
transformation.

## 4. Matching

`utils.js: scoreExperienceAgainstText()` is a keyword-overlap heuristic: it tokenizes the pasted
job text, then checks each experience's skills/tools/tags (weight 3), title/organization (weight
2), and description/metrics (weight 1) for overlapping tokens. Higher weight fields count more
because a listed skill is a stronger signal of relevance than words that happen to appear in prose.

## 5. Importing from a resume / LinkedIn export

`views/importResume.js` lets a user bootstrap their database from documents they already have,
instead of starting from a blank form. The pipeline is three independent stages, chained but not
coupled:

```
File (PDF/DOCX/TXT)
  → parsers/textExtraction.js   (extractTextFromFile)     → raw text string
  → parsers/resumeParser.js       (parseResumeText)          ⎫
    or parsers/aiResumeParser.js  (parseResumeTextWithAI)    ⎬→ { candidateExperiences, candidateSkills }
  → views/importResume.js       (review UI)                → state.js: addExperience() / upsertSkill()
```

**Text extraction** (`parsers/textExtraction.js`) dispatches on file extension: PDF via a
self-hosted copy of pdf.js (clusters each page's text items into lines by baseline position — a
heuristic, since PDF has no real concept of "lines"), DOCX via a self-hosted copy of mammoth.js
(`extractRawText`), and TXT/MD by reading the file directly. Both libraries live under `vendor/`
(see `vendor/VERSIONS.md`) rather than a CDN, so imports work offline and the page never depends on
a third party at runtime; both are loaded lazily on first use so they don't add to initial page
weight.

**Resume parsing — two interchangeable backends, same contract.** Both take `(rawText,
sourceLabel[, config])` and resolve to `{ candidateExperiences, candidateSkills }`; `views/
importResume.js` picks one based on a checkbox and otherwise treats them identically.

- **Offline heuristic** (`parsers/resumeParser.js`, the default) — a pure function, no DOM or I/O,
  no network, no cost. It splits lines into sections by matching common resume headers (Experience,
  Skills, Projects, etc.), then within the Experience/Projects sections finds date-range lines (e.g.
  "Sept 2025 – Present") as anchors and groups the surrounding lines into one candidate Experience
  per anchor. The Skills section is split into a de-duplicated list of candidate names. **This is a
  heuristic, not an AI** — resume and LinkedIn-export layouts vary too much to parse perfectly
  offline, so "good first draft" is the design target, not "correct." Every candidate is
  provenance-tagged with `sourceLabel` (the filename) and its raw source block, both shown in the
  review UI.

- **AI-assisted, bring-your-own-key** (`parsers/aiResumeParser.js`, opt-in) — calls the Anthropic
  Messages API directly from the browser with an API key the user supplies (see §6 below). It uses
  structured outputs (`output_config.format` with a JSON Schema) so the response is guaranteed
  valid JSON matching the candidate shape — no markdown-fence stripping needed — and generally
  produces more accurate candidates on documents whose layout confuses the positional heuristic
  parser (e.g. company-before-title ordering). `sourceText` on AI-produced candidates is the full
  source document rather than a per-block excerpt, since an LLM's own extraction isn't reliably
  traceable back to an exact substring the way the heuristic parser's anchor-based blocks are.

**Cross-file dedup.** Uploading a resume alongside a LinkedIn export routinely describes the same
job twice — without merging, every overlapping role would appear as a separate review card. As each
file is parsed, every candidate it produces is checked against candidates already collected (from
this file or an earlier one) via `findMatchingCandidate()`: same organization, same title (fuzzy,
case/punctuation-insensitive substring match), and compatible dates (within ~45 days, or one side
missing a date). A match merges into the existing card via `mergeCandidateInto()` — unique
description lines from both are combined, source labels/raw text accumulate as arrays, and any
missing start/end date is backfilled — instead of appending a duplicate. The review card shows
"Found in N files and merged automatically" whenever this happens, with one "Show raw extracted
text" block per contributing file, so the merge is visible and reversible (the user can still edit
or uncheck the card). This runs identically for the offline and AI-assisted parsers, since it
operates on the parser's output shape, not on how a candidate was produced.

**Review and commit** happens entirely in `views/importResume.js`, regardless of which parser
produced the candidates: nothing reaches `state.js` until the user reviews/edits each candidate
experience (pre-checked, but every field is a live editable input) and toggles which candidate
skills to keep, then clicks "Add Selected." Imported experiences are tagged `source: 'imported'`
and get a note recording which file(s) they came from, so they're distinguishable from hand-entered
ones later.

## 6. AI assistance (opt-in, bring-your-own-key)

Iceberg works fully offline by default — everything in §§1–5 above requires no network access. Two
features additionally offer an AI-assisted path that's off unless the user turns it on:

| Feature | Offline default | AI-assisted alternative |
|---|---|---|
| Resume/LinkedIn parsing (§5) | `parsers/resumeParser.js` | `parsers/aiResumeParser.js` |
| STAR refinement (Add/Edit Experience form) | `experienceForm.js: buildRefinedDescription()` | `parsers/aiRefine.js: refineExperienceWithAI()` |

Both AI modules call the Anthropic Messages API (`claude-sonnet-5` by default — configurable)
directly from the browser with a key the user supplies. There is no backend to hold a secret
server-side (see §3), so this is a deliberately prototype-grade integration: the request carries
Anthropic's `anthropic-dangerous-direct-browser-access` header (its documented opt-in for exactly
this shape of client-only, single-user tool), and the key never leaves the browser except in
requests sent straight to `api.anthropic.com`.

**One config, one settings UI, reused everywhere.** `aiConfig.js` is the single localStorage-backed
source of truth for `{ enabled, apiKey, model }`, and `components/aiSettingsPanel.js` is the one
piece of UI that reads/writes it — `renderAiSettingsPanel(container, { onChange })` renders into any
container and returns the live config object, which the caller reads at the moment it's needed
(e.g. when a "Parse" or "AI-refine" button is clicked). Both `views/importResume.js` and
`views/experienceForm.js` call this same function rather than building their own key-entry UI, so
enabling AI assistance and saving a key in one place makes it available everywhere else too.

**Verifying a key works.** The settings panel also has a "Test connection" button, backed by
`aiVerify.js: verifyAiConnection(config)`. It sends the smallest possible request to
`api.anthropic.com/v1/messages` (`max_tokens: 1`, `thinking: {type: "disabled"}`) against whatever
key/model is currently typed — independent of Save — and reports "✓ Connected" or a specific error
(invalid key, unknown model, network failure). This lets a user confirm their key works before
relying on it inside a real parse or refine call.

**Adding a third AI-assisted feature** later means: write a module following the `aiResumeParser.js`
/ `aiRefine.js` pattern (a `fetch` to `api.anthropic.com/v1/messages` with the two headers above,
`thinking: {type: "disabled"}` for a straightforward single-call task, structured outputs when the
result needs to be parsed back into typed fields), call `renderAiSettingsPanel()` in the view that
needs it, and add a button that awaits the new module's function — no changes needed to `aiConfig.js`
or the settings component itself.

## 7. Expandability notes (from the brief)

- **AI-assisted expansion of experiences** — implemented; see §6 above.
- **AI-assisted resume parsing** — implemented; see §5 and §6 above.
- **More sophisticated matching/scoring** — `utils.js: scoreExperienceAgainstText()` is the single
  function `views/match.js` calls. Swap keyword overlap for an embeddings/AI call there; the return
  contract (`{ score, matched }`) is the only thing callers depend on.
- **Real database / cloud storage** — `storage.js: loadData()` / `saveData()` are the only two
  functions that read/write `localStorage`. Make them `async`, point them at a backend API, and
  `await` their calls from `state.js`; every view is unaffected because it never imports
  `storage.js` directly.
- **Polished resume/LinkedIn export** — `views/exportImport.js` already has the file-download
  plumbing; add a second button that formats `getAllExperiences()` (from `state.js`) as
  markdown/plain text instead of JSON.
- **New experience types / skill categories** — add an entry to `EXPERIENCE_TYPES` or
  `SKILL_CATEGORIES` in `data-model.js`; every `<select>` that renders those lists picks it up
  automatically.
- **New views** — write a `views/yourview.js` exporting `render(root, params)`, add a route in
  `app.js: parseRoute()`, and add a nav link in `index.html`.
