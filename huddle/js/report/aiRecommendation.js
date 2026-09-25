/**
 * AI-assisted game plan (optional, bring-your-own-key): turns the already
 * fully-computed roster/matchup/start-sit/waiver data into an actual written
 * recommendation instead of a bare list of point deltas. Everything upstream
 * of this (espnClient.js, lineup.js) runs offline; only this JSON summary —
 * never ESPN cookies, never the raw ESPN response — is sent to Anthropic.
 *
 * Same direct browser-to-Anthropic approach as Pulse's report/aiReport.js:
 * BYOK, `anthropic-dangerous-direct-browser-access`, structured output via
 * `output_config.format`.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an expert fantasy football analyst helping someone set their weekly lineup and weigh waiver moves in a standard ESPN fantasy football league.

You are given a JSON summary that has already been computed for you: this week's roster (starters and bench, each with position, pro team, this week's projected points, recent actual-points trend, injury status, and bye week if applicable), the current matchup (your projected total vs. your opponent's), a pre-computed list of start/sit suggestions where a bench player's raw projection beats a starter's, a pre-computed list of waiver add/drop suggestions where an available free agent's projection beats your weakest rostered player at that position, and your next few scheduled opponents plus any upcoming bye weeks.

Do not invent stats that aren't in the summary — every specific number you cite must come from the data provided. Your job is judgment, not new information: weigh the pre-computed suggestions against context they didn't account for (a QUESTIONABLE tag, a wide gap between the recent-actual trend and this week's projection, a bye week two weeks out that changes whether a waiver move is worth a roster spot now). It's fine to agree with a pre-computed suggestion, disagree with it, or add nuance it missed — say which and why.

Keep it tight: this is read on a phone before a lineup-lock deadline, not a research report. Only include a lineupMoves or waiverMoves entry when you actually have something worth saying about it — don't pad the list by restating every pre-computed suggestion verbatim.`;

const RECOMMENDATION_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One or two sentences: the matchup outlook and the single biggest decision to make this week',
    },
    lineupMoves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'sit', 'monitor'] },
          player: { type: 'string' },
          reasoning: { type: 'string', description: 'Grounded in the specific numbers/trend/injury status provided' },
        },
        required: ['action', 'player', 'reasoning'],
        additionalProperties: false,
      },
    },
    waiverMoves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          add: { type: 'string' },
          drop: { type: 'string' },
          reasoning: { type: 'string' },
        },
        required: ['add', 'drop', 'reasoning'],
        additionalProperties: false,
      },
    },
    watchList: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short reminders to double check before lineups lock (injury statuses, upcoming byes)',
    },
  },
  required: ['headline', 'lineupMoves', 'waiverMoves', 'watchList'],
  additionalProperties: false,
};

/**
 * @param {object} summary - see myTeam.js: buildAiSummary()
 * @param {{ apiKey: string, model?: string }} config
 */
export async function generateAiRecommendation(summary, config) {
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
      max_tokens: 2048,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: RECOMMENDATION_SCHEMA } },
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
