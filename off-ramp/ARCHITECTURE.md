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
  js/
    data-model.js           Entity shapes + factories (Experience, Skill) — the source of truth
    storage.js                localStorage read/write + JSON export/import serialization
    state.js                   In-memory store, CRUD operations, pub/sub — the only module views touch
    utils.js                    IDs, HTML escaping, date formatting, keyword search/matching
    app.js                       Hash-based router: URL hash → view module
    views/
      dashboard.js               Timeline/list, search + filters
      experienceForm.js           Add/edit form + "Strengthen this experience" (STAR) flow
      skills.js                    Skills & Tools inventory, grouped by category
      match.js                      Paste a job description → ranked relevant experiences
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

## 5. Expandability notes (from the brief)

- **AI-assisted expansion of experiences** — `experienceForm.js: buildRefinedDescription()` is a
  pure, synchronous function that assembles the STAR fields into text. Replace its call site with
  an `await` on an AI API call (keep the same input shape, return a string) and nothing else in the
  form changes.
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
