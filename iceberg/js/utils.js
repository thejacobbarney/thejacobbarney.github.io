/**
 * Small, dependency-free helpers shared across the app: ID generation,
 * HTML escaping, date formatting, and the keyword-matching logic used by
 * the "Match Against Job" view.
 *
 * TO EXTEND MATCHING:
 *   `scoreExperienceAgainstText()` is intentionally a simple keyword-overlap
 *   heuristic so the whole app works offline with zero dependencies. Swap
 *   its internals for a call to an AI/embedding API later without touching
 *   any caller — it always returns { score, matched }.
 */

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Escapes a value for safe insertion into HTML text or attribute contexts. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/** Renders a human-readable date range for an Experience (handles ongoing/single-date cases). */
export function formatDateRange(exp) {
  const start = formatDate(exp.startDate);
  if (exp.isOngoing) return start ? `${start} – Present` : 'Present';
  const end = formatDate(exp.endDate);
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end || 'Undated';
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those',
  'as', 'it', 'its', 'from', 'will', 'shall', 'you', 'your', 'our', 'we', 'they', 'their',
  'have', 'has', 'had', 'do', 'does', 'did', 'not', 'no', 'so', 'if', 'than', 'then',
  'about', 'into', 'over', 'under', 'per', 'etc', 'including', 'include', 'includes',
]);

/** Lowercases, strips punctuation, and splits text into tokens (keeps things like "c++" and "3.5"). */
export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Extracts a de-duplicated set of "meaningful" keywords from free text. */
export function extractKeywords(text) {
  return Array.from(new Set(tokenize(text)));
}

/**
 * Scores how relevant an Experience is against a set of job-description
 * keywords, weighting skills/tools/tags above prose. Returns
 * { score: number, matched: string[] }.
 *
 * This is deliberately simple and fully offline. To upgrade later: replace
 * the body of this function with a call to an embeddings/AI API and keep
 * the same return shape — the only caller (views/match.js) never needs to
 * change.
 */
export function scoreExperienceAgainstText(experience, jobKeywords) {
  const jobSet = new Set(jobKeywords);
  const matched = new Set();

  const weighted = [
    {
      text: [...experience.skillsHard, ...experience.skillsSoft, ...experience.tools, ...experience.tags].join(' '),
      weight: 3,
    },
    { text: `${experience.title} ${experience.organization}`, weight: 2 },
    {
      text: `${experience.refinedDescription} ${experience.originalDescription} ${experience.metrics}`,
      weight: 1,
    },
  ];

  let score = 0;
  for (const { text, weight } of weighted) {
    for (const token of tokenize(text)) {
      if (jobSet.has(token)) {
        matched.add(token);
        score += weight;
      }
    }
  }

  return { score, matched: Array.from(matched) };
}

/** Normalizes a comma-separated string into a trimmed, de-duped array. */
export function parseListInput(str) {
  return Array.from(
    new Set(
      (str || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}
