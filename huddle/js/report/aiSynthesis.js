/**
 * Final analysis across AI views (optional, bring-your-own-key). Takes every view that has been run
 * for one decision (Claude's, plus Grok's and Perplexity's if available) and has Claude write up
 * where they agree, where they differ, how to resolve the differences, and a final recommendation.
 *
 * Only the other views' structured results and a short description of the decision are sent, the
 * same kind of computed summaries the individual AI features already send; never ESPN cookies or
 * the raw ESPN response.
 */

import { callClaudeJson } from './claudeJson.js';

const SYSTEM_PROMPT = `You are the final reviewer for a fantasy football decision. Several AI analysts each examined the same decision independently. You are given a short description of the decision and each analyst's structured output.

The analysts differ in what they can see. "Claude" worked only from the computed league data (no live search). "Grok" and "Perplexity" searched the live web, so they may know newer injury and role news, but they can also repeat rumors, so note which of their claims are marked confirmed versus reported or rumor, and which carry cited sources.

Write the final analysis:
- Common themes: points two or more analysts independently agree on. Name who agrees.
- Key differences: where analysts disagree or one raised something the others missed. State each analyst's position, then say how to resolve it (for example, prefer fresher confirmed live news for injury questions, prefer the data-grounded point for value questions, or say it cannot be resolved without checking X).
- A final recommendation with the rationale. If the analysts split and nothing resolves it, say so and name the deciding factor to check, rather than manufacturing a consensus.
- Confidence: high only if the analysts largely agree and the key facts are confirmed.
- Open questions: concrete things the user should verify before acting.

Use only what is in the inputs. Do not add new facts or numbers. If an analyst's output was unstructured text, use it as written. Keep it tight: this is read on a phone before acting.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One or two sentences: where the analysts land overall' },
    commonThemes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          theme: { type: 'string' },
          detail: { type: 'string' },
          agreedBy: { type: 'array', items: { type: 'string' } },
        },
        required: ['theme', 'detail', 'agreedBy'],
        additionalProperties: false,
      },
    },
    keyDifferences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          positions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { source: { type: 'string' }, position: { type: 'string' } },
              required: ['source', 'position'],
              additionalProperties: false,
            },
          },
          howToResolve: { type: 'string' },
        },
        required: ['topic', 'positions', 'howToResolve'],
        additionalProperties: false,
      },
    },
    finalRecommendation: {
      type: 'object',
      properties: { action: { type: 'string' }, rationale: { type: 'string' } },
      required: ['action', 'rationale'],
      additionalProperties: false,
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'commonThemes', 'keyDifferences', 'finalRecommendation', 'confidence', 'openQuestions'],
  additionalProperties: false,
};

/**
 * @param {string} decision - short description of what was analyzed ("a proposed trade", ...)
 * @param {object} brief - small JSON describing the specific decision
 * @param {{ source: string, kind: 'offline-data'|'live-search', result: object }[]} views
 */
export async function generateSynthesis(decision, brief, views, config) {
  return callClaudeJson({
    system: SYSTEM_PROMPT,
    schema: SCHEMA,
    input: { decision, brief, analysts: views },
    config,
    maxTokens: 3000,
  });
}
