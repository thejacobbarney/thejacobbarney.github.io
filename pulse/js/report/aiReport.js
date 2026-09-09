/**
 * AI-assisted synthesis (optional, bring-your-own-key): turns the already
 * fully-computed inventory/baselines/patterns into the two parts of the
 * report that require judgment rather than arithmetic — the ranked "Top 5
 * Leverage Points" and the "Weekly Protocol." Everything upstream of this
 * (inventory.js, baselines.js, patterns.js) runs offline in this browser;
 * only this JSON summary — never the raw per-day file contents — is sent
 * to Anthropic.
 *
 * Same direct browser-to-Anthropic approach as Iceberg's aiRefine.js /
 * aiResumeParser.js: BYOK, `anthropic-dangerous-direct-browser-access`,
 * structured output via `output_config.format`.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an elite personal health analyst with deep expertise in wearable technology, sleep science, cardiovascular physiology, and behaviour-change coaching.

You are given a JSON summary of one person's wearable data that has already been computed for you: a file/data inventory, baseline averages across sleep/cardio/recovery/activity metrics, and a pattern analysis (trends, variances, correlations, flagged events). You are not given the raw daily rows — do not invent numbers that aren't in the summary.

Your job:
1. Identify the 5 most impactful, fixable leverage points, ranked most-impactful first. Each must be highly specific to this person and grounded in the actual numbers/trends/correlations in the summary — reference exact figures. Never give generic health advice. If fewer than 5 genuinely data-supported leverage points exist, return fewer rather than padding with speculation.
2. Synthesize a weekly protocol: 2-3 non-negotiable changes (highest impact), 2-4 quick wins (low-friction, compounding), the exact metrics to watch to confirm the changes are working, and — ONLY if genuinely warranted by the data (e.g. SpO2 repeatedly below 90%, resting heart rate persistently and severely elevated, irregular rhythm flags) — flags for medical attention. Leave flags empty otherwise; do not manufacture medical concern from ordinary variation.

If the dataset covers fewer than 14 days, treat patterns as suggestive rather than statistically reliable, and say so in a leverage point's "why it matters" text where relevant rather than overstating confidence.

Tone: a knowledgeable friend who has actually studied this person's data. Direct, specific, genuinely useful. No filler, no disclaimers beyond genuinely warranted medical flags.`;

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    leveragePoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plain-English issue name' },
          data: { type: 'string', description: 'The specific numbers/trends that reveal this' },
          why: { type: 'string', description: 'Plain-English physiological explanation' },
          impact: { type: 'string', description: 'Estimated downstream impact of fixing it' },
          actions: { type: 'array', items: { type: 'string' }, description: '1-3 specific, low-friction actions for this week' },
        },
        required: ['name', 'data', 'why', 'impact', 'actions'],
        additionalProperties: false,
      },
    },
    protocol: {
      type: 'object',
      properties: {
        nonNegotiables: { type: 'array', items: { type: 'string' } },
        quickWins: { type: 'array', items: { type: 'string' } },
        watchClosely: { type: 'array', items: { type: 'string' }, description: 'Each item: metric + what change to look for' },
        flags: { type: 'array', items: { type: 'string' }, description: 'Only genuinely warranted medical-attention flags; empty otherwise' },
      },
      required: ['nonNegotiables', 'quickWins', 'watchClosely', 'flags'],
      additionalProperties: false,
    },
  },
  required: ['leveragePoints', 'protocol'],
  additionalProperties: false,
};

/**
 * @param {object} summary - { inventory, baselines, patterns } as produced by analysis/*.js
 * @param {{ apiKey: string, model?: string }} config
 */
export async function generateAiReport(summary, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No Anthropic API key configured — add one in AI assistance settings.');
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
      model: config.model || 'claude-sonnet-5',
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: REPORT_SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(summary) }],
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
    throw new Error('The model declined to analyze this data.');
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('The model returned no output.');
  }
  return JSON.parse(textBlock.text);
}
