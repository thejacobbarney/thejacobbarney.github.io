# Bark — Job Application Tracker & AI Evaluator — Architecture

`index.html` in this folder is a working, client-only prototype (React 18 + Babel Standalone,
zero build step, deployed as a static page — same pattern as `/movie-spork`). It proves out the
UX and the matching/salary logic using an offline heuristic engine, with an optional bring-your-own-
OpenAI-key upgrade path.

A static GitHub Pages site cannot run a scraper or hold shared secrets, so it cannot be the real,
multi-user product described in the brief — reliable LinkedIn/Indeed scraping and safe AI-key
handling both require a backend. This document specifies that production system: the stack, the
data model, how scraping should actually work against JS-heavy/anti-bot sites, the AI evaluation
contract, and the export pipeline — everything needed to lift the prototype into a real app.

---

## 1. Tech Stack Recommendation

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 14 (App Router) + React + Tailwind CSS** | Server components for the dashboard/analytics reads, client components for the interactive add-job flow; Tailwind maps cleanly onto the Neo-Brutalist token system (hard borders, flat shadows, no radius). |
| Auth + DB | **Supabase (Postgres + Auth + Row-Level Security)** | One provider for auth, relational storage, and realtime subscriptions (pipeline status updates across tabs/devices) without standing up separate services. |
| Scraping | **Playwright** on a **queue-backed worker** (see §3), fronted by **ScrapingBee or Browserless** for the JS-heavy / anti-bot sources (LinkedIn, Indeed) | Playwright handles the general case (JS-rendered career pages) cheaply; a managed scraping API absorbs residential-proxy and headless-detection costs for the two hardest sources instead of building that infrastructure in-house. |
| AI | **OpenAI API (`gpt-4o-mini` default, upgradeable to `gpt-4o`)**, called **server-side only** | Keeps the API key off the client; lets you cache/rate-limit per user; response-format `json_object` enforces the evaluation schema (see §5). |
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
                     │  OpenAI Evaluation │
                     │  (server-side key) │
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
  match_score integer check (match_score between 0 and 100),
  salary_target numeric,
  salary_target_low numeric,
  salary_target_high numeric,
  matched_skills text[] default '{}',
  missing_skills text[] default '{}',
  analysis text,
  model text,                      -- e.g. 'gpt-4o-mini'
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

Stated salary is often absent. The prototype already does something useful here client-side:
when a listing has no salary, `estimateComparableSalary` (`index.html`) matches the title against
a hardcoded table of ~16 role families (Software Engineering, Finance & Accounting, Product,
Sales, etc.), applies a seniority multiplier read off title keywords ("Senior", "Director", "Staff")
or the profile's years of experience, and returns a market low/high — surfaced on the job card as
a `Market $X–$Y` badge and folded into the career analysis as a call-anchoring number ("use
$X–$Y as your anchor on an intro call, with $Y as your opening ask"). When an OpenAI key is set,
the same offline estimate is passed to the model as a prior and the model can refine it
(`comparableSalaryLow/High/Context` in the AI schema, §4.2) using broader knowledge of the specific
title/industry/location — still an LLM estimate, not a live quote, and the UI/analysis text says so.

That's a reasonable stand-in, but it's not real market data. The production upgrade is to replace
the hardcoded table with an actual compensation data source — query a source keyed on normalized
job title + location (Levels.fyi has no public API; realistic options are the **BLS OEWS API** for
occupational wage percentiles by metro area, or a paid source like **Payscale's API**) and store the
result on `jobs.comparable_salary_low/high`. Run this as a second queue job alongside the AI
evaluation, not inline — it's a network call with its own latency/failure mode.

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
- **Tier 2 — LLM evaluation**: richer, handles nuance (adjacent skills, seniority framing,
  culture/scope signals in the description) that keyword overlap can't.

### 4.2 Prompt template (production, server-side)

```
SYSTEM:
You are a career-matching engine inside a job application tracker. Given a candidate's
background and a job posting, evaluate fit with rigor and honesty — do not inflate scores
to be encouraging, and call out real gaps. Respond with ONLY a JSON object matching this
exact schema, no prose outside it:
{
  "matchScore": number 0-100,
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
`index.html`'s `AI_SYSTEM_PROMPT` / `buildAiPrompt`, callable today if you supply your own key in
the prototype's Settings tab.

### 4.3 Production hardening

- **Server-side only.** The prototype calls OpenAI directly from the browser with a user-supplied
  key — acceptable for a single-user personal tool, wrong for a real product. In production this
  call moves into an API route/server action; the key lives in an environment variable, never
  reaches the client.
- **Validate the response** against the schema (e.g. `zod`) before writing to `evaluations` —
  don't trust the model to always emit valid JSON even with `response_format` set.
- **Fall back to Tier 1** on any error (timeout, invalid JSON, rate limit) rather than failing the
  whole "add job" flow — exactly the fallback the prototype already does client-side.
- **Cache per (job, profile-version)** — re-evaluating on every dashboard load is wasteful; only
  re-run when the profile changes or the user explicitly asks to re-score.

---

## 5. Frontend Components (Next.js / Tailwind, Neo-Brutalist)

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
    borderRadius: { none: '0px' }, // Neo-Brutalism: no rounded corners
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

## 6. Export Logic

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

## 7. What the prototype deliberately simplifies

| Production concern | Prototype's stand-in |
|---|---|
| Multi-user auth + RLS | Single browser, `localStorage` |
| Server-side scraping queue | Direct `fetch` + optional public CORS proxy, manual paste fallback |
| LinkedIn/Indeed anti-bot handling | Not attempted — routes to manual paste |
| Server-held OpenAI key | User-supplied key, stored in `localStorage`, called from the browser |
| Comparable-salary market data | Hardcoded role-family benchmark table + optional AI refinement — not a real wage data source (see §3.4) |
| Evaluation history / score drift | Only the latest evaluation per job is kept |

Everything else — extraction logic, scoring math, salary targeting, the career-analysis prompt,
the dashboard/analytics/export UX — is the same code path described here, just running client-side
instead of on a server. That's intentional: it's the fastest way to validate the product idea
before investing in the backend.
