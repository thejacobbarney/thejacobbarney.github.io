/**
 * Resume / LinkedIn export parser.
 *
 * Pure text-in, candidates-out heuristics — no DOM, no I/O, easy to unit
 * test and easy to replace. Given raw extracted text (from
 * textExtraction.js), this splits it into sections by common resume
 * headers, then pulls candidate Experience records out of the
 * "Experience"/"Projects" sections and candidate skill names out of the
 * "Skills" section.
 *
 * This is deliberately a heuristic, not a real NLP/AI parser — resumes and
 * LinkedIn PDF exports vary too much in layout to parse perfectly offline.
 * Every candidate this produces is meant to be reviewed and edited by the
 * user (see views/importResume.js) before it's added to the database, so
 * "good first draft" is the bar, not "perfect."
 *
 * TO EXTEND: to swap this for a real AI-based extraction later, replace
 * `parseResumeText()` with an async function (e.g. sending the raw text to
 * an API) that resolves to the same
 * `{ candidateExperiences, candidateSkills }` shape — views/importResume.js
 * only depends on that shape, not on how it's produced.
 */

const SECTION_HEADERS = {
  summary: ['summary', 'profile', 'objective', 'about'],
  experience: [
    'experience',
    'work experience',
    'professional experience',
    'employment history',
    'work history',
    'relevant experience',
  ],
  education: ['education', 'academic background'],
  skills: [
    'skills',
    'skills & tools',
    'technical skills',
    'core competencies',
    'areas of expertise',
    'top skills',
  ],
  projects: ['projects', 'personal projects', 'key projects'],
  certifications: [
    'certifications',
    'licenses & certifications',
    'licenses and certifications',
    'certifications & licenses',
  ],
};

const MONTH_INDEX = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_PATTERN =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_TOKEN = `(?:${MONTH_PATTERN}\\.?\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
const SEP = '(?:-|–|—|to)';
const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*${SEP}\\s*(${DATE_TOKEN}|Present|Current)`, 'i');

function matchSectionHeader(line) {
  const normalized = line.toLowerCase().replace(/[:：]+$/, '').trim();
  if (normalized.length > 40) return null;
  for (const [section, headers] of Object.entries(SECTION_HEADERS)) {
    if (headers.includes(normalized)) return section;
  }
  return null;
}

/** Buckets lines into resume sections by scanning for known header lines. */
function splitIntoSections(lines) {
  const sections = {
    header: [],
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
  };
  let current = 'header';
  for (const line of lines) {
    const matched = matchSectionHeader(line);
    if (matched) {
      current = matched;
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function parseDateToken(token) {
  const t = token.trim();
  let m = t.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m) {
    const key = m[1].toLowerCase();
    const monthNum = MONTH_INDEX[key] || MONTH_INDEX[key.slice(0, 3)];
    if (monthNum) return `${m[2]}-${String(monthNum).padStart(2, '0')}-01`;
  }
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  m = t.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  return '';
}

function parseDateRange(line) {
  const match = line.match(DATE_RANGE_RE);
  if (!match) return { startDate: '', endDate: '', isOngoing: false };
  const isOngoing = /present|current/i.test(match[2]);
  return {
    startDate: parseDateToken(match[1]),
    endDate: isOngoing ? '' : parseDateToken(match[2]),
    isOngoing,
  };
}

/**
 * Builds one candidate Experience from a block of lines that make up a
 * single role/entry. `dateLineIndex`, if known, is where the date-range
 * line falls within the block; otherwise it's located by scanning.
 */
function buildCandidateFromBlock(blockLines, dateLineIndex, type) {
  let idx = dateLineIndex;
  if (idx === undefined || idx < 0 || !DATE_RANGE_RE.test(blockLines[idx] || '')) {
    idx = blockLines.findIndex((l) => DATE_RANGE_RE.test(l));
  }
  const headerLines = idx >= 0 ? blockLines.slice(0, idx) : blockLines.slice(0, 1);
  const dateLine = idx >= 0 ? blockLines[idx] : '';
  const bodyLines = idx >= 0 ? blockLines.slice(idx + 1) : blockLines.slice(1);

  const { startDate, endDate, isOngoing } = dateLine
    ? parseDateRange(dateLine)
    : { startDate: '', endDate: '', isOngoing: false };

  const cleanedBody = bodyLines
    .map((l) => l.replace(/^[•\-*▪◦∙]\s*/, '').trim())
    .filter(Boolean);

  return {
    title: headerLines[0] || '(untitled — review me)',
    organization: (headerLines[1] || '').split('·')[0].trim(),
    startDate,
    endDate,
    isOngoing,
    type,
    originalDescription: cleanedBody.join('\n'),
    sourceText: blockLines.join('\n'),
  };
}

/**
 * Splits a section's lines into candidate Experience blocks, using
 * detected date-range lines as anchors between entries. Falls back to
 * treating the whole section as one entry if no dates are found.
 */
function parseExperienceSection(lines, type) {
  if (lines.length === 0) return [];
  const anchorIdxs = [];
  lines.forEach((line, i) => {
    if (DATE_RANGE_RE.test(line)) anchorIdxs.push(i);
  });

  if (anchorIdxs.length === 0) {
    return [buildCandidateFromBlock(lines, -1, type)];
  }

  const candidates = [];
  for (let k = 0; k < anchorIdxs.length; k++) {
    const anchor = anchorIdxs[k];
    const blockStart = k === 0 ? 0 : Math.max(anchorIdxs[k - 1] + 1, anchor - 2);
    const nextAnchor = anchorIdxs[k + 1];
    const blockEnd = nextAnchor !== undefined ? Math.max(anchor + 1, nextAnchor - 2) : lines.length;
    const block = lines.slice(blockStart, blockEnd);
    candidates.push(buildCandidateFromBlock(block, anchor - blockStart, type));
  }
  return candidates;
}

/** Splits the Skills section into a de-duplicated list of skill/tool names. */
function parseSkillsSection(lines) {
  const text = lines.join(', ');
  const seen = new Set();
  const skills = [];
  for (const raw of text.split(/[,;•|\n]+/)) {
    const cleaned = raw.replace(/\(\d+\)/g, '').trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length > 1 && cleaned.length < 60 && !seen.has(key)) {
      seen.add(key);
      skills.push(cleaned);
    }
  }
  return skills;
}

/**
 * Parses raw extracted document text into review-ready candidates.
 * `sourceLabel` (typically the filename) is attached to every candidate
 * experience so the review UI can show where it came from.
 */
export function parseResumeText(rawText, sourceLabel = '') {
  const lines = (rawText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const sections = splitIntoSections(lines);

  const jobCandidates = parseExperienceSection(sections.experience, 'job');
  const projectCandidates = parseExperienceSection(sections.projects, 'project');
  const candidateExperiences = [...jobCandidates, ...projectCandidates].map((c) => ({
    ...c,
    sourceLabel,
  }));

  const candidateSkills = parseSkillsSection(sections.skills);

  return { candidateExperiences, candidateSkills };
}
