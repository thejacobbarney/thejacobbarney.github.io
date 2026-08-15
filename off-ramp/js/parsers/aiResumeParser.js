/**
 * AI-assisted resume parser (optional, bring-your-own-key).
 *
 * Implements the exact swap-in contract ARCHITECTURE.md describes for
 * resumeParser.js: `parseResumeTextWithAI(rawText, sourceLabel, config)`
 * resolves to the same `{ candidateExperiences, candidateSkills }` shape
 * the heuristic parser produces, so views/importResume.js can use either
 * one interchangeably.
 *
 * Off-ramp has no backend (see ARCHITECTURE.md), so this calls the
 * Anthropic API directly from the browser with a user-supplied key — the
 * `anthropic-dangerous-direct-browser-access` header is Anthropic's
 * documented opt-in for exactly this shape of client-only, single-user
 * tool. The key is read from aiConfig.js (localStorage) and sent straight
 * to api.anthropic.com; it never passes through any server of ours.
 *
 * Uses structured outputs (`output_config.format`) so the response is
 * guaranteed valid JSON matching RESUME_SCHEMA — no markdown-fence
 * stripping or regex extraction needed.
 */

import { EXPERIENCE_TYPES } from '../data-model.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT =
  'You extract structured career-history data from resumes, LinkedIn exports, and CVs. ' +
  'For every distinct role, project, or notable achievement in the document, produce one ' +
  'candidate experience. Extract every skill, tool, and technology mentioned anywhere in the ' +
  'document (not only in a "Skills" section) as a deduplicated list. Use empty strings for ' +
  'dates you cannot determine and ISO 8601 (YYYY-MM-DD) for dates you can — use the 1st of the ' +
  "month when only a month and year are given. Write originalDescription as that entry's " +
  "accomplishments and responsibilities, one per line, in the candidate's own words where " +
  "possible — don't invent achievements that aren't in the source.";

const RESUME_SCHEMA = {
  type: 'object',
  properties: {
    candidateExperiences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          organization: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          isOngoing: { type: 'boolean' },
          type: { type: 'string', enum: EXPERIENCE_TYPES.map((t) => t.value) },
          originalDescription: { type: 'string' },
        },
        required: ['title', 'organization', 'startDate', 'endDate', 'isOngoing', 'type', 'originalDescription'],
        additionalProperties: false,
      },
    },
    candidateSkills: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['candidateExperiences', 'candidateSkills'],
  additionalProperties: false,
};

export async function parseResumeTextWithAI(rawText, sourceLabel, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No Anthropic API key configured — add one in AI parsing settings.');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model || 'claude-opus-5',
      max_tokens: 8192,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: RESUME_SCHEMA } },
      messages: [{ role: 'user', content: `Source document: "${sourceLabel}"\n\n${rawText}` }],
    }),
  });

  if (!response.ok) {
    let message = `Anthropic API error (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Keep the generic message if the error body isn't JSON.
    }
    throw new Error(message);
  }

  const data = await response.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('The model declined to process this document.');
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('The model returned no extractable output.');
  }
  const parsed = JSON.parse(textBlock.text);

  const candidateExperiences = (parsed.candidateExperiences || []).map((c) => ({
    title: c.title || '(untitled — review me)',
    organization: c.organization || '',
    startDate: c.startDate || '',
    endDate: c.endDate || '',
    isOngoing: Boolean(c.isOngoing),
    type: c.type || 'job',
    originalDescription: c.originalDescription || '',
    sourceText: rawText,
    sourceLabel,
  }));

  const candidateSkills = Array.from(new Set(parsed.candidateSkills || []));

  return { candidateExperiences, candidateSkills };
}
