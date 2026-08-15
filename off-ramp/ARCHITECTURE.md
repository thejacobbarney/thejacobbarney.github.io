# Off-ramp — Career Journal — Architecture

Off-ramp is a client-only, zero-build-step web app (vanilla HTML/CSS/JS, ES modules) that acts as
a living, three-dimensional record of a professional's work history. It goes beyond a static resume
by letting you capture raw experiences as they happen, refine them into impact-focused STAR-style
descriptions later, and match your full history against a specific job description when it's time
to apply or interview.

Everything lives in the browser (`localStorage`). There is no backend, no auth, and no build tool —
this is deliberate: the brief asked for content and structure first, styled and expanded later.

## 1. File layout

```
off-ramp/
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
    parsers/
      textExtraction.js           File → raw text, dispatched by extension (PDF/DOCX/TXT)
      resumeParser.js              Raw text → candidate Experience/Skill records (offline heuristic)
      aiResumeParser.js             Same contract as resumeParser.js, via the Anthropic API (opt-in, BYOK)
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

`storage.js` is the only module that touches `localStorage`, under the key `offramp:data:v1`. The
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
  Messages API (`claude-opus-5` by default) directly from the browser with an API key the user
  supplies via the view's settings panel and `aiConfig.js` persists to `localStorage`. There is no
  backend to hold a secret server-side (see "Persistence" above), so this is a deliberately
  prototype-grade integration: the request carries Anthropic's `anthropic-dangerous-direct-browser-
  access` header (its documented opt-in for exactly this shape of client-only tool), and the key
  never leaves the browser except in requests sent straight to `api.anthropic.com`. It uses
  structured outputs (`output_config.format` with a JSON Schema) so the response is guaranteed
  valid JSON matching the candidate shape — no markdown-fence stripping needed — and generally
  produces more accurate candidates on documents whose layout confuses the positional heuristic
  parser (e.g. company-before-title ordering). `sourceText` on AI-produced candidates is the full
  source document rather than a per-block excerpt, since an LLM's own extraction isn't reliably
  traceable back to an exact substring the way the heuristic parser's anchor-based blocks are.

**Review and commit** happens entirely in `views/importResume.js`, regardless of which parser
produced the candidates: nothing reaches `state.js` until the user reviews/edits each candidate
experience (pre-checked, but every field is a live editable input) and toggles which candidate
skills to keep, then clicks "Add Selected." Imported experiences are tagged `source: 'imported'`
and get a note recording which file they came from, so they're distinguishable from hand-entered
ones later.

## 6. Expandability notes (from the brief)

- **AI-assisted expansion of experiences** — `experienceForm.js: buildRefinedDescription()` is a
  pure, synchronous function that assembles the STAR fields into text. Replace its call site with
  an `await` on an AI API call (keep the same input shape, return a string) and nothing else in the
  form changes.
- **AI-assisted resume parsing** — implemented as an opt-in, bring-your-own-key path
  (`parsers/aiResumeParser.js`) alongside the offline heuristic; see §5 above. To point it at a
  different provider or a proxied backend later, only `aiResumeParser.js`'s internals need to
  change — it's the only module that knows the request shape, and `views/importResume.js` only
  depends on the shared `{ candidateExperiences, candidateSkills }` return contract.
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
