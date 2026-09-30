/**
 * AI-assisted trade analysis (optional, bring-your-own-key) — same BYOK
 * contract as report/aiRecommendation.js: sends only the computed trade
 * summary (both full rosters plus the specific players in the trade),
 * never ESPN cookies or the raw ESPN response.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an expert fantasy football analyst evaluating a proposed trade in a standard ESPN fantasy football league — either a trade the user is considering offering, or one they were offered and are deciding whether to accept.

You are given a JSON summary that has already been computed: both teams' full current rosters (position, recent scoring average, projected points this week, injury status, bye week), which specific players are moving each direction, and a computed value comparison (recent-form scoring average on each side, not a single week's projection).

Do not invent stats that aren't in the summary — every specific number you cite must come from the data provided. Go beyond the raw value comparison: consider roster construction after the trade (does either side end up thin at a position, or with a redundant surplus at another), bye-week stacking (does the trade concentrate several key players on the same bye week), and injury risk concentration (does one side end up overly reliant on injury-prone players). A trade can be close in value but still bad for one side's roster construction, or lopsided in value but justified by addressing a real roster hole — say so explicitly when that's the case rather than only restating the point totals.

Never call a player droppable or worthless solely because he's OUT, QUESTIONABLE, or on a bye this single week — check his recent scoring average in the summary first.

Keep it tight: this is read on a phone while deciding whether to accept or counter, not a research report.`;

const TRADE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['favors_you', 'favors_them', 'even'] },
    headline: { type: 'string', description: 'One or two sentences: the bottom line on this trade' },
    reasoning: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific points grounded in the provided data — value, roster fit, bye weeks, injury risk',
    },
    rosterImpact: {
      type: 'object',
      properties: {
        you: { type: 'string', description: 'How your roster changes after this trade — new strengths or gaps' },
        them: { type: 'string', description: 'How the other side\'s roster changes after this trade' },
      },
      required: ['you', 'them'],
      additionalProperties: false,
    },
    risks: {
      type: 'array',
      items: { type: 'string' },
      description: 'Bye-week stacking, injury concentration, or other risks this trade introduces — empty if none',
    },
  },
  required: ['verdict', 'headline', 'reasoning', 'rosterImpact', 'risks'],
  additionalProperties: false,
};

/**
 * @param {object} summary - see render/trade.js: buildTradeAiSummary()
 * @param {{ apiKey: string, model?: string }} config
 */
export async function generateTradeAnalysis(summary, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No Anthropic API key configured — add one in AI assistance settings on My Team.');
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
      max_tokens: 2048,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: TRADE_SCHEMA } },
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
    throw new Error('The model declined to analyze this trade.');
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('The model returned no output.');
  }
  return JSON.parse(textBlock.text);
}
