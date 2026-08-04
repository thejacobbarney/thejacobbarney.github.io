# Bark — Job Application Tracker & AI Evaluator — Architecture

`index.html` in this folder is a working, client-only prototype (React 18 + Babel Standalone,
zero build step, deployed as a static page — same pattern as `/movie-spork`). It proves out the
UX and the matching/salary logic using an offline heuristic engine, with optional bring-your-own-key
upgrade paths for Grok (match scoring) and Perplexity (live salary search).

A static GitHub Pages site cannot run a scraper or hold shared secrets, so it cannot be the real,
multi-user product described in the brief — reliable LinkedIn/Indeed scraping and safe AI-key
handling both require a backend. This document specifies that production system: the stack, the
data model, how scraping should actually work against JS-heavy/anti-bot sites, the AI evaluation
contract, and the export pipeline — everything needed to lift the prototype into a real app.

---

## 1. Tech Stack Recommendation

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 14 (App Router) + React + Tailwind CSS** | Server components for the dashboard/analytics reads, client components for the interactive add-job flow; Tailwind maps cleanly onto the bold, high-contrast token system (hard borders, flat shadows, no radius). |
| Auth + DB | **Supabase (Postgres + Auth + Row-Level Security)** | One provider for auth, relational storage, and realtime subscriptions (pipeline status updates across tabs/devices) without standing up separate services. |
| Scraping | **Playwright** on a **queue-backed worker** (see §3), fronted by **ScrapingBee or Browserless** for the JS-heavy / anti-bot sources (LinkedIn, Indeed) | Playwright handles the general case (JS-rendered career pages) cheaply; a managed scraping API absorbs residential-proxy and headless-detection costs for the two hardest sources instead of building that infrastructure in-house. |
| AI (match scoring) | **xAI Grok API (`grok-4-fast` default)**, called **server-side only** | OpenAI-compatible request/response shape, so the same `response_format: json_object` pattern applies; keeps the key off the client and lets you cache/rate-limit per user (see §4.3). |
| AI (salary search) | **Perplexity Sonar API**, called **server-side only** | Web search grounding is built into the model rather than bolted on as a tool call — a better fit for "find current comp data" than a general-purpose model with a search plugin, and it returns real source citations (see §3.4). |
| Profile import | **PDF.js** (client-side text extraction) + **Grok** for structured parsing (see §5) | Resumes/LinkedIn exports are unstructured PDFs; extraction has to happen somewhere, and doing it client-side avoids uploading a resume to a server just to read its text. |
| Queue/Jobs | **Postgres-backed queue (`pgmq` or a Supabase Edge Function + cron)**, or **Inngest** if you want retries/backoff without managing infra | Scraping and AI evaluation are both slow, flaky, and rate-limited — they belong off the request/response path. |
| Hosting | **Vercel** (frontend + API routes) — pairs natively with Next.js and Supabase | Zero-config previews, edge-friendly, no server ops. |
| Export | **CSV**: generated server-side or client-side, trivial. **Google Sheets**: Google Identity Services (GIS) OAuth token flow, called directly from the browser with the user's own consent — no backend credential storage needed. | Sheets API supports CORS for authenticated browser requests, so this is the one integration that genuinely doesn't need a backend proxy. |

**Why not scrape everything with one client-side proxy?** CORS proxies (used in the prototype's
"demo mode") are fine for a personal single-user tool but are unreliable, rate-limited, and not
something you'd depend on for a real product — hence Playwright/ScrapingBee behind a queue in
production.

---

## 2. System Architecture & Data Schema

```
┌────────────┐      ┌──────────────────┐      ┌───────────────────┐
│  Next.js    │◄────►│  API routes /      │◄────►│  Supabase Postgres │
│  Frontend   │      │  Server Actions    │      │  (+ RLS, Auth)     │
└────────────┘      └────────┬──────────┘      └───────────────────┘
                              │ enqueue
                              ▼
                     ┌──────────────────┐
                     │  Scrape+Eval Queue │
                     └────────┬──────────┘
                    ┌─────────┴─────────┐
                    ▼                   ▼
          ┌──────────────────┐ ┌──────────────────┐
          │ Playwright worker │ │ ScrapingBee/     │
          │ (own infra pages) │ │ Browserless      │
          │                   │ (LinkedIn/Indeed) │
          └────────┬─────────┘ └────────┬─────────┘
                    └─────────┬──────────┘
                               ▼
                     ┌──────────────────┐
                     │  Extraction +      │
                     │  Normalization     │
                     └────────┬──────────┘
                               ▼
                     ┌──────────────────┐
                     │  Grok match eval + │
                     │  Perplexity salary │
                     │  (server-side keys)│
                     └────────┬──────────┘
                               ▼
                     write job + evaluation → Postgres → push to client (Supabase Realtime)
```

### Data schema (Postgres)

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  years_experience numeric,
  target_roles text,
  skills text[] not null default '{}',
  summary text,
  current_salary numeric,
  target_salary numeric,
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text,
  title text not null,
  company text,
  location text,
  work_form text check (work_form in ('remote','hybrid','onsite')),
  description text,
  requirements text[] default '{}',
  skills text[] default '{}',
  salary_min numeric,
  salary_max numeric,
  salary_currency text default 'USD',
  comparable_salary_low numeric,   -- market comp benchmark, §3.4
  comparable_salary_high numeric,
  status text not null default 'In Progress'
    check (status in ('In Progress','Applied','Interviewing','Dead End','Offer')),
  scrape_source text,              -- 'json-ld' | 'playwright' | 'scrapingbee' | 'manual-paste'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  match_score integer check (match_score between 1 and 10),
  salary_target numeric,
  salary_target_low numeric,
  salary_target_high numeric,
  matched_skills text[] default '{}',
  missing_skills text[] default '{}',
  analysis text,
  model text,                      -- e.g. 'grok-4-fast'
  created_at timestamptz not null default now()
);

create index jobs_user_status_idx on jobs (user_id, status);
create index jobs_user_created_idx on jobs (user_id, created_at desc);
```

`evaluations` is kept separate from `jobs` (1:many, latest wins) so re-running the AI evaluation
after a profile update doesn't destroy history — the analytics view can show score drift over time.

Row-Level Security: every table scoped to `auth.uid() = user_id` (via `jobs.user_id` for
`evaluations`, joined) — standard multi-tenant isolation, no cross-user reads possible.

---

## 3. Scraping Strategy — Edge Cases

### 3.1 Tiered extraction (cheapest first)

1. **JSON-LD `JobPosting` (schema.org)** — the majority of ATS-backed career pages (Greenhouse,
   Lever, Workday, Ashby, most in-house sites) embed this. Zero JS execution needed — a plain
   `fetch` + `<script type="application/ld+json">` parse is enough. This is what the prototype
   implements client-side and it's genuinely production-viable server-side too.
2. **Server-rendered HTML fallback** — no JSON-LD, but the title/description are in the initial
   HTML (many older career sites). Parse with `cheerio` against a small per-domain selector map.
3. **Playwright headless render** — the page requires JS execution to populate content (client-
   rendered React/Angular career pages). Render, wait for a content selector, extract.
4. **Managed scraping API (ScrapingBee/Browserless)** — LinkedIn and Indeed specifically: they
   fingerprint headless browsers, rotate challenge pages, and rate-limit aggressively per IP.
   Running Playwright directly against them from your own IPs will get blocked quickly. Route
   *only* these domains through a managed API with residential proxies and JS rendering built in.
5. **Manual paste fallback** — always available, always works, zero anti-bot exposure. The
   prototype's "Paste Text" mode implements the same regex/heuristic parser this tier would use
   server-side (`parseFreeText` in `index.html`).

### 3.2 Domain-aware routing

```ts
function pickStrategy(url: string): 'json-ld' | 'playwright' | 'scrapingbee' {
  const host = new URL(url).hostname;
  if (/linkedin\.com|indeed\.com/.test(host)) return 'scrapingbee';
  if (/greenhouse\.io|lever\.co|myworkdayjobs\.com|ashbyhq\.com/.test(host)) return 'json-ld';
  return 'playwright'; // unknown domain: try JSON-LD first inside the worker, fall back to render
}
```

### 3.3 Rate limiting & politeness

- Per-domain concurrency cap (e.g. 2 concurrent requests) and a minimum delay between requests to
  the same host, enforced by the queue worker, not the caller.
- Respect `robots.txt` for anything scraped without a managed API's consent-covered access.
- Cache successful extractions by normalized URL for 24h so re-adding the same listing (common —
  users paste the same job from two tabs) doesn't re-scrape.

### 3.4 Comparable compensation search (brief's §1.E.i)

Stated salary is often absent. The prototype layers three tiers, cheapest/always-available first,
each one upgrading the estimate when its prerequisite is configured:

1. **Offline benchmark table** (always on). `estimateComparableSalary` (`index.html`) matches the
   title against a hardcoded table of ~16 role families (Software Engineering, Finance &
   Accounting, Product, Sales, etc.), applies a seniority multiplier read off title keywords
   ("Senior", "Director", "Staff") or the profile's years of experience, and returns a market
   low/high. Zero network calls, zero keys required.
2. **Grok static-knowledge estimate** (if a Grok key is set and no better source ran). The offline
   estimate is passed to the model as a prior in `buildMatchPrompt`, and the model can refine it
   using broader training-data knowledge of the specific title/industry/location
   (`comparableSalaryLow/High/Context` in the match-eval schema, §4.2). Still not a live quote —
   Grok isn't given search access for this call, just asked to reason from what it already knows.
3. **Perplexity Sonar with built-in web search** (if a Perplexity key is set) — `fetchSalaryBenchmark`
   in `index.html`. This is a genuine live web search, not a knowledge-cutoff guess, and takes
   priority over both tiers above when it succeeds:
   - **One call**, not two. Unlike a general-purpose model with a search tool bolted on, Sonar
     reasons over live search results as part of normal generation, so the prompt asks it to
     identify the standardized role (title, industry, seniority, location) *and* return the
     benchmark in a single round trip — `{clean_title, industry, experience_level, location,
     min_salary, median_salary, max_salary, confidence_score, rationale}`.
   - The call goes through Perplexity's REST endpoint directly (`fetch` to
     `api.perplexity.ai/chat/completions`, OpenAI-compatible chat-completions shape) — same
     bring-your-own-key pattern as the Grok tier, with the same client-side-key caveat (§8).
   - The response includes a `citations` array of real source URLs, which Bark renders as clickable
     links under the career analysis — actual sources beat a vague "estimated" sentence when
     you're prepping for a call.
   - **Response parsing is defensive**: the app tries `JSON.parse` on the raw content first, then
     falls back to extracting the first `{...}` block via regex, since Sonar isn't guaranteed to
     skip prose around the JSON the way a strict-JSON-mode model would.
   - The result is also validated before being trusted (`isUsableLiveBenchmark`): a
     `confidence_score` of `"low"`, or numbers that don't hold up (non-numeric, `min > max`, `<= 0`),
     get rejected in favor of whatever tier 1/2 already produced. On any failure — bad key, rate
     limit, network, unusable numbers — it degrades to the existing estimate silently (a
     `console.warn` only), since a live-search miss isn't an error state worth interrupting the
     user over. Only a Grok match-eval failure surfaces a toast (§4.3), because that affects the
     primary match score, not just an optional enrichment.

Whichever tier wins, the range is surfaced as a `Market $X–$Y` badge (🔎 prefix when it's the live
Perplexity result) and folded into the career analysis as a call-anchoring number: "use $X–$Y as
your anchor on an intro call, with $Y as your opening ask." The Perplexity tier's `rationale` — a
sentence naming the sources behind the number — gets appended directly to that analysis text, and
its citations render as clickable source links underneath.

This is a reasonable production pattern already — live search grounding is a real market-data
source, not a hardcoded table — but it still inherits the browser-side-key caveat from §8: for a
multi-user product, the Perplexity calls move server-side (same reasoning as the Grok evaluation
call) so the key isn't exposed per-client. The alternative production path — a dedicated
compensation data API like **BLS OEWS** (occupational wage percentiles by metro area) or
**Payscale's API** — is still worth considering as a more structured, purpose-built data source if
Sonar's search grounding proves inconsistent in practice; either way, this becomes a queue job
alongside the AI evaluation once there's a backend, not an inline call.

### 3.4a Target-clamping policy: when is the recommendation allowed to exceed the range?

`computeSalaryTarget` nudges the recommendation above or below the midpoint of its anchor (posted
range, comparable band, or profile target) based on match score — a strong fit should aim toward
the top, a weak one toward the bottom. Whether that nudge is allowed to push the recommendation
*past* the anchor's edges depends on what kind of anchor it is, and the three cases resolve
differently:

- **A real, two-sided posted range** (distinct `salaryMin`/`salaryMax`) is a hard employer-stated
  ceiling and floor — the target is clamped to `[salaryMin, salaryMax]`. Recommending an ask above
  the employer's own advertised top undermines the tool's straight-talk premise, so this direction
  never exceeds.
- **An open-ended floor** (`"$120,000+"` — parsed as `salaryMin` set, `salaryMax` left `null` rather
  than collapsed into a fake `min === max` range) has no ceiling to respect, so the target is
  allowed to exceed it on a strong match. It's still a floor, though: a weak match score is clamped
  up to at least `salaryMin`, never recommending an ask below what the employer already committed to
  paying at minimum.
- **No posted salary at all**, falling back to the comparable-roles band: the target is clamped to
  `[comparable.low, comparable.high]` for the same reason as the real-range case — the tool is
  citing that band as the market anchor in the same breath as the recommendation, so exceeding it
  would contradict its own advice. A profile-target-only fallback (no comparable data available
  either) has no external range to clamp against and floats freely, same as before.

The same clamping applies when Grok generates the salary numbers directly (bypassing
`computeSalaryTarget` when a stated salary exists) — `evaluateJob` re-derives `isRealRange`/
`isOpenFloor` from the job's own `salaryMin`/`salaryMax` and clamps Grok's `salaryTarget` the same
way, rather than trusting the model to always honor the equivalent instruction baked into
`MATCH_SYSTEM_PROMPT`.

### 3.5 Legal/ethical note

Scraping LinkedIn and Indeed listing pages for personal job-search tracking (not republishing,
not bulk harvesting) is common practice, but both sites' ToS restrict automated access. A managed
scraping API doesn't remove that risk, it just makes the *technical* problem tractable — flag this
to the user before shipping a multi-tenant product, and prefer manual paste as the default for
those two domains if ToS risk tolerance is low.

---

## 4. AI Evaluation & Match Engine

### 4.1 Two-tier design

The prototype ships both tiers so it works with zero configuration:

- **Tier 1 — offline heuristic** (`computeMatch`, `computeSalaryTarget`,
  `generateCareerAnalysis` in `index.html`): skill-overlap scoring against the profile's skill
  list, a years-of-experience-vs-required-years seniority adjustment, and a templated 2-3 sentence
  writeup. Deterministic, free, instant — the right default and the right fallback when the AI
  call fails or is rate-limited.
- **Tier 2 — LLM evaluation (Grok)**: richer, handles nuance (adjacent skills, seniority framing,
  culture/scope signals in the description) that keyword overlap can't.

**Stretch vs. mismatch narrative.** The numeric score alone can't tell a user *why* a role landed
below "strong match" — a role can score mid/low because it's a genuine reach toward the next
career level (core skills line up, but it asks for more years/scope than the candidate has yet),
or because the candidate is actually missing skills the role requires. Those call for opposite
advice, so `generateCareerAnalysis` (and the equivalent instruction baked into
`MATCH_SYSTEM_PROMPT` for the Grok tier) classifies which situation applies — using
`matchResult.missing` as a share of total required skills plus the years-required-vs-years-held
gap already computed by `computeMatch` — and writes the analysis accordingly: "healthy stretch
toward the next level" when the shortfall is mostly seniority/scope, or a direct "real
mismatch"/"gaps in core requirements" framing when the shortfall is mostly missing skills. This
only changes the wording of the analysis text; `matchResult.score` and its red/yellow/green
color coding are computed exactly as before and are never adjusted for this distinction.

### 4.2 Prompt template (production, server-side)

```
SYSTEM:
You are a career-matching engine inside a job application tracker. Given a candidate's
background and a job posting, evaluate fit with rigor and honesty — do not inflate scores
to be encouraging, and call out real gaps. A role doesn't have to be a near-perfect match
to be worth pursuing: when the score is below 8, look at WHERE the gap actually is. If core
skills line up well and the shortfall is mainly seniority/years/scope, say so explicitly and
frame it as a legitimate stretch toward the next level — not a warning sign. If the gap is
concentrated in core skills the role requires, say so explicitly too and be direct that it's
a real mismatch rather than a seniority reach. This distinction only affects the analysis
text, never the numeric score. Respond with ONLY a JSON object matching this
exact schema, no prose outside it:
{
  "matchScore": number 1-10 (integer, 10 = perfect match),
  "salaryTarget": number | null,
  "salaryRangeLow": number | null,
  "salaryRangeHigh": number | null,
  "analysis": string,        // 2-3 sentences
  "matchedSkills": string[],
  "missingSkills": string[]
}

USER:
CANDIDATE BACKGROUND
Years of experience: {{profile.yearsExp}}
Skills: {{profile.skills.join(", ")}}
Target roles: {{profile.targetRoles}}
Current salary: {{profile.currentSalary || "not specified"}}
Target salary: {{profile.targetSalary || "not specified"}}
Summary: {{profile.summary}}

JOB POSTING
Title: {{job.title}}
Company: {{job.company}}
Location: {{job.location}}
Work form: {{job.workForm}}
Stated salary: {{job.salaryMin}}-{{job.salaryMax}} {{job.salaryCurrency}} | "not disclosed"
Comparable market range: {{job.comparableSalaryLow}}-{{job.comparableSalaryHigh}} | "unavailable"
Description:
{{job.description | truncate(6000)}}

Evaluate the match and return the JSON object only.
```

Call with `response_format: { type: "json_object" }` and a low temperature (0.3–0.4) — this is a
scoring task, not a creative one; consistency matters more than variety. This exact template
(minus the comparable-salary line, which the prototype has no data source for) is implemented in
`index.html`'s `MATCH_SYSTEM_PROMPT` / `buildMatchPrompt`, callable today if you supply your own
Grok key in the prototype's Settings tab. It's sent to `api.x.ai/v1/chat/completions` with
`model: "grok-4-fast"` — xAI's endpoint mirrors OpenAI's chat-completions shape closely enough
that this is effectively the same integration pattern regardless of which of the two you'd pick
in production.

### 4.3 Production hardening

- **Server-side only.** The prototype calls Grok directly from the browser with a user-supplied
  key — acceptable for a single-user personal tool, wrong for a real product. In production this
  call moves into an API route/server action; the key lives in an environment variable, never
  reaches the client.
- **Validate the response** against the schema (e.g. `zod`) before writing to `evaluations` —
  don't trust the model to always emit valid JSON even with `response_format` set.
- **Fall back to Tier 1** on any error (timeout, invalid JSON, rate limit) rather than failing the
  whole "add job" flow — exactly the fallback the prototype already does client-side.
- **Cache per (job, profile-version)** — re-evaluating on every dashboard load is wasteful; only
  re-run when the profile changes or the user explicitly asks to re-score.

### 4.4 Refresh / re-scoring after the profile changes

Match score, salary target, and career analysis are computed once when a job is saved and frozen
into that job's record — if the profile changes afterward (new skills, updated years of experience,
a resume import), previously-saved jobs go stale. `evaluateJob(job, profile, settings)` in
`index.html` is the fix: it's the exact same offline/Perplexity/Grok pipeline described above,
factored out of the "Add Job" save handler into a standalone function so it can run again later
against any job's already-stored data plus the *current* profile, rather than only at save time.

Two entry points call it:
- **Per-job "Refresh"** on each `JobCard` — re-scores that one job.
- **"Refresh All Scores"** on the dashboard toolbar — re-scores every tracked job in one pass
  (`Promise.all` over the job list), useful right after a profile update or resume import so the
  whole pipeline reflects the new information at once instead of one card at a time.

Both write straight back onto the job record (matchScore, salaryTarget, comparableSalary\*,
careerAnalysis, evalEngine, plus a `lastEvaluatedAt` timestamp shown on the card) — no separate
history is kept client-side. That's a deliberate simplification the production schema already
anticipates: §2's `evaluations` table is modeled 1:many against `jobs` specifically so re-running
an evaluation writes a *new* row instead of overwriting the old one, which is what you'd want in
production to see score drift over time rather than just the latest snapshot.

---

## 5. Profile Building — Resume / LinkedIn PDF Import

Manually typing skills, years of experience, and a summary into the Profile tab works, but most
people already have that information sitting in a resume or a LinkedIn "Save to PDF" export. The
prototype can read either directly:

1. **PDF text extraction with line reconstruction** — [PDF.js](https://mozilla.github.io/pdf.js/)
   loaded from CDN (`unpkg.com/pdfjs-dist@3.11.174`), same "load a script tag, no build step"
   pattern as React/Babel. PDF.js exposes a classic UMD global (`window.pdfjsLib`) at this pinned
   version, which matters because newer `pdfjs-dist` releases dropped the non-module build from
   the default `build/` path — worth re-checking if this version is bumped later. The important
   detail is *how* `extractPdfText` reads the page: PDF.js's raw text items have no concept of
   lines, so a naive `.join(" ")` collapses a LinkedIn export's one-skill-per-line sidebar into a
   single unsplittable blob. `extractPdfText` instead compares each item's Y coordinate
   (`item.transform[5]`) against the previous one and inserts a real line break whenever it jumps —
   the standard technique for recovering line structure from PDF.js, and the difference between
   "Top Skills" coming back as three distinct entries versus one unusable string.
2. **Section-aware offline pass** (always runs): rather than blindly keyword-matching the whole
   document against `extractSkillsFromText`'s ~100-word dictionary, `parseResumeTextOffline` first
   looks for LinkedIn/resume section headers on their own line (`Top Skills`, `Certifications`,
   `Summary`, `Experience`, `Education`, …) via `sliceResumeSection`, and treats their contents as
   authoritative: self-reported skills and certifications go straight into the profile verbatim
   (catching things no fixed dictionary would, like "Earned Value Management (EVM)" or
   "Organization Skills"), the `Summary`/`About` section becomes the profile summary directly, and
   `estimateYearsFromResumeText` only scans date ranges *inside* the `Experience` section — not
   `Education` — so a degree's start year doesn't inflate years-of-experience. The dictionary match
   still runs across the whole document and merges in on top, catching skills mentioned in bullet
   prose that never made it into a self-reported list. Free, instant, no key required.

   One real bug this replaced: the original date-range regex only matched bare `"2019 - 2023"` or
   `"2019 - Present"`. Real resumes/LinkedIn exports almost always name the month on *both* ends
   (`"November 2024 - September 2025"`), which that regex didn't handle at all — it silently
   skipped every range except whichever one ended in "Present", understating years of experience
   by years on a real multi-job history. The pattern now tolerates an optional month word before
   the closing year/present token.
3. **Grok refinement** (if a key is set): `callGrokParseResume` sends the line-reconstructed text
   to `grok-4-fast` with a schema asking for `skills`, `yearsExp`, `targetRoles`, and a first-person
   `summary`, explicitly instructed to treat sidebar-style skill/certification sections as real
   skills and to compute years only from Experience, not Education. Still meaningfully better than
   the offline pass for `targetRoles`, which requires inferring a logical next job title from
   career trajectory — not something either the dictionary or section-slicing can do.

Extracted results are shown in an editable review panel before anything touches the saved profile
— same "extract → review → confirm" pattern as adding a job — with one deliberate asymmetry in
how "Apply" merges fields: **skills merge and dedupe** against whatever's already in the profile
(case-insensitive), since skills accumulate across resume versions and shouldn't be lost on a
re-import, while **years of experience, target roles, and summary are overwritten** with the
extracted values, since merging two numbers or two prose summaries doesn't make sense the way
merging two skill lists does — the review step is what keeps this safe, not the merge logic.

---

## 6. Frontend Components (Next.js / Tailwind)

The prototype's component split (`AddJobTab`, `DashboardTab`, `JobCard`, `ProfileTab`,
`AnalyticsTab`, `SettingsTab`) maps directly onto Next.js — each becomes a client component under
`app/(dashboard)/`, backed by server actions instead of `localStorage`. The Tailwind translation of
the design tokens used in `index.html`'s CSS:

```js
// tailwind.config.js (excerpt)
theme: {
  extend: {
    colors: {
      ink: '#111111',
      cream: '#FBF3E3',
      turq: '#00D9C0',
      purple: '#6C2BD9',
      yellow: '#FFCE3D',
      pink: '#FF5C8A',
    },
    boxShadow: {
      brutal: '4px 4px 0 #111111',
      'brutal-sm': '2px 2px 0 #111111',
      'brutal-lg': '7px 7px 0 #111111',
    },
    borderRadius: { none: '0px' }, // hard edges: no rounded corners
  }
}
```

```jsx
// components/JobCard.tsx (shape — see index.html for the full working version)
export function JobCard({ job, onStatusChange }: { job: Job; onStatusChange: (id: string, s: Status) => void }) {
  return (
    <div className="border-[3px] border-ink bg-white shadow-brutal p-6">
      <div className="flex gap-4">
        <ScoreDial score={job.matchScore} />
        <div className="flex-1">
          <h3 className="text-lg font-bold">{job.title}</h3>
          <p className="text-sm font-bold text-purple-700">{job.company}</p>
          <StatusSelect value={job.status} onChange={(s) => onStatusChange(job.id, s)} />
        </div>
      </div>
    </div>
  );
}
```

---

## 7. Export Logic

- **CSV** — fully implemented client-side in the prototype (`exportCSV` in `index.html`): builds
  the CSV string, wraps in a `Blob`, triggers a download via an object URL. Identical approach
  works server-side (Next.js route returning `text/csv` with a `Content-Disposition` header) if you
  want export history/audit logging.
- **Google Sheets** — also fully implemented in the prototype (`exportToGoogleSheets`): loads
  Google Identity Services, requests an OAuth token scoped to `spreadsheets` via
  `initTokenClient`, creates a new spreadsheet, and appends rows via the Sheets API v4 — all
  directly from the browser, no backend credential storage required. Production requirement: an
  OAuth 2.0 Client ID (Web application type) from Google Cloud Console with the deployed origin
  registered under "Authorized JavaScript origins" and the Sheets API enabled on the project.

---

## 8. What the prototype deliberately simplifies

| Production concern | Prototype's stand-in |
|---|---|
| Multi-user auth + RLS | Single browser, `localStorage` |
| Server-side scraping queue | Direct `fetch` + optional public CORS proxy, manual paste fallback |
| LinkedIn/Indeed anti-bot handling | Not attempted — routes to manual paste |
| Server-held Grok / Perplexity keys | User-supplied keys, stored in `localStorage`, called from the browser |
| Comparable-salary market data | Three-tier fallback (offline table → Grok static-knowledge estimate → live Perplexity search) — the Perplexity tier is genuinely live with real citations, but still called client-side with a user-supplied key (see §3.4) |
| Evaluation history / score drift | Only the latest evaluation per job is kept |

Everything else — extraction logic, scoring math, salary targeting, the career-analysis prompt,
the dashboard/analytics/export UX — is the same code path described here, just running client-side
instead of on a server. That's intentional: it's the fastest way to validate the product idea
before investing in the backend.
