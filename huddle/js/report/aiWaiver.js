/**
 * Claude's waiver check (optional, bring-your-own-key): judges the computed add/drop suggestions
 * from the summary alone, with no live search, so it is the offline-data counterpart to the Grok
 * and Perplexity waiver checks. Same result shape as theirs (research/normalize.js: normalizeWaiver)
 * so the three can be shown and compared side by side.
 */

import { callClaudeJson } from './claudeJson.js';
import { GRADES } from '../trade.js';
import { HUDDLE_NOTE } from './promptNotes.js';

const SYSTEM_PROMPT = `You are an expert fantasy football analyst checking waiver-wire moves for an ESPN fantasy football team.

You are given a JSON summary that was already computed: the user's roster (position, recent scoring average, this week's projection, injury status, bye week, and weekly points so far this season), add/drop suggestions computed offline from projected points, and the top available free agents by position. You cannot search the web, so do not claim to know news that is not in the summary; say when something depends on news you cannot see.

Judge each suggested move: is the added player's production a real role or a one-week spike (use the weekly points), is the dropped player actually expendable (use his season log, not this week's projection), and does bye-week timing matter. Give a go, wait, or skip verdict and an A+ to F grade for each move. You may name better pickups only from the available free agents list. Do not invent players or stats.

Never recommend dropping a player solely because he is OUT, QUESTIONABLE, or on a bye this single week. Check his recent average first.

${HUDDLE_NOTE}

Keep it tight. This is read on a phone before submitting a claim.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One or two sentences: the bottom line on these waiver moves' },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          add: { type: 'string' },
          drop: { type: 'string' },
          verdict: { type: 'string', enum: ['go', 'wait', 'skip'] },
          grade: { type: 'string', enum: GRADES },
          newsOnAdd: { type: 'string', description: 'What the data says about the added player\'s role and trend; note if news is unknown' },
          newsOnDrop: { type: 'string', description: 'What the data says about the dropped player\'s long-term value' },
          reasoning: { type: 'string' },
        },
        required: ['add', 'drop', 'verdict', 'grade', 'newsOnAdd', 'newsOnDrop', 'reasoning'],
        additionalProperties: false,
      },
    },
    betterTargets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, why: { type: 'string' } },
        required: ['name', 'why'],
        additionalProperties: false,
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'moves', 'betterTargets', 'notes'],
  additionalProperties: false,
};

/** @returns {Promise<{ data: object, rawText: string, sources: string[] }>} */
export async function generateClaudeWaiverCheck(summary, config) {
  const data = await callClaudeJson({ system: SYSTEM_PROMPT, schema: SCHEMA, input: summary, config });
  return { data, rawText: '', sources: [] };
}
