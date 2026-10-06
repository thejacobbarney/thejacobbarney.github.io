/**
 * Grok (xAI) second opinion on a trade, bring-your-own-key. Unlike the
 * Claude analysis in aiTrade.js (which only sees the computed summary), this
 * call lets Grok search the live web and X for injury and performance news on
 * the specific players involved, and recall their prior-season history.
 *
 * Sends the same computed trade summary as aiTrade.js plus, when one has
 * already been generated, Claude's analysis so Grok can critique it. Never
 * ESPN cookies or the raw ESPN response.
 *
 * Request/response shapes follow xAI's Responses API with its built-in
 * web_search and x_search tools. They were written without live access to
 * xAI's docs or API (see ARCHITECTURE.md), so parsing here is deliberately
 * tolerant and errors surface xAI's own message.
 */

import { GRADES } from '../trade.js';

const API_URL = 'https://api.x.ai/v1/responses';

export const TRADE_SYSTEM_PROMPT = `You are an expert fantasy football analyst giving a second opinion on a proposed trade in an ESPN fantasy football league. The user may be considering offering it or deciding whether to accept one they received.

You are given a JSON summary: both teams' rosters (position, recent scoring average, this week's projection, injury status, bye week, and a season log of weekly points so far this season), the specific players moving each direction, and possibly an analysis another AI already wrote (claudeAnalysis).

Use your live search before answering. For every player in the trade (and any other player whose status matters to the verdict), search the web (and X, where you can) for the latest injury reports, practice participation, snap-count or role changes, and credible beat-reporter news. Also recall each traded player's prior-season and career performance trend from your own knowledge, and say clearly when you are recalling rather than citing something you found.

Rules:
- Every number about this season must come from the provided summary. Numbers from search results or memory must be labeled as such.
- Never call a player droppable or worthless solely because he is OUT, QUESTIONABLE, or on a bye this single week. Check his season log first.
- If a player's status in the summary conflicts with what you find in search, trust the search and say so.
- Distinguish confirmed reports from rumor or speculation.
- If claudeAnalysis is provided, give honest feedback on it: where you agree, where you disagree, and anything it missed. If it is not provided, set feedbackOnOtherAnalysis to null.
- Grade the trade from each side's perspective on a letter scale: A+ is a clear, lopsided win for that side, B is a modest win, C is a fair trade that roughly breaks even, D is a modest loss, F is a clearly bad trade for that side. Make the two grades consistent with each other, and let injury and role news you found move the grade.
- Keep it tight. This is read on a phone while deciding whether to accept or counter.

Respond with ONLY a single JSON object, no markdown fences, in exactly this shape:
{
  "verdict": "favors_you" | "favors_them" | "even",
  "yourGrade": "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "D-" | "F",
  "theirGrade": "same scale, for the other team",
  "headline": "one or two sentence bottom line",
  "playerUpdates": [ { "name": "player name", "status": "short status such as Healthy, Questionable (hamstring), Out", "update": "latest news in one or two sentences, with how fresh it is", "confidence": "confirmed" | "reported" | "rumor" | "no news found" } ],
  "history": [ { "name": "player name", "note": "prior-season and career trend relevant to this trade, one or two sentences" } ],
  "reasoning": [ "specific point", "..." ],
  "risks": [ "specific risk", "..." ],
  "feedbackOnOtherAnalysis": "string or null"
}`;

function authHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

async function errorMessage(response, fallback) {
  if (response.status === 401) return 'Invalid xAI API key.';
  try {
    const body = await response.json();
    const msg = body?.error?.message || body?.error || body?.message;
    if (typeof msg === 'string' && msg) return msg;
  } catch {
    // Keep the generic message if the error body isn't JSON.
  }
  return fallback;
}

/** Pulls assistant text and cited URLs out of a Responses API payload, tolerating shape drift. */
function readResponse(data) {
  const texts = [];
  const urls = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (typeof part?.text === 'string') texts.push(part.text);
      for (const ann of part?.annotations || []) {
        if (typeof ann?.url === 'string') urls.push(ann.url);
      }
    }
  }
  if (texts.length === 0 && typeof data?.output_text === 'string') texts.push(data.output_text);
  if (texts.length === 0 && data?.choices?.[0]?.message?.content) texts.push(data.choices[0].message.content);
  for (const c of data?.citations || []) {
    if (typeof c === 'string') urls.push(c);
    else if (typeof c?.url === 'string') urls.push(c.url);
  }
  const safeUrls = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 8);
  return { text: texts.join('\n').trim(), sources: safeUrls };
}

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const asArray = (v) => (Array.isArray(v) ? v : []);

export function normalizeTradeOpinion(parsed) {
  if (!parsed) return null;
  return {
    verdict: ['favors_you', 'favors_them', 'even'].includes(parsed.verdict) ? parsed.verdict : null,
    yourGrade: GRADES.includes(parsed.yourGrade) ? parsed.yourGrade : null,
    theirGrade: GRADES.includes(parsed.theirGrade) ? parsed.theirGrade : null,
    headline: String(parsed.headline || ''),
    playerUpdates: asArray(parsed.playerUpdates),
    history: asArray(parsed.history),
    reasoning: asArray(parsed.reasoning).map(String),
    risks: asArray(parsed.risks).map(String),
    feedbackOnOtherAnalysis:
      typeof parsed.feedbackOnOtherAnalysis === 'string' ? parsed.feedbackOnOtherAnalysis : null,
  };
}

/**
 * @param {object} summary - see render/trade.js: buildTradeAiSummary(), optionally with claudeAnalysis
 * @param {{ apiKey: string, model?: string }} config
 * @returns {Promise<{ opinion: object|null, rawText: string, sources: string[] }>}
 */
export async function generateGrokTradeOpinion(summary, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No xAI API key configured. Add one in the Grok settings on My Team.');
  }

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: config.model || 'grok-4',
        input: [
          { role: 'system', content: TRADE_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(summary) },
        ],
        tools: [{ type: 'web_search' }, { type: 'x_search' }],
      }),
    });
  } catch {
    throw new Error(
      'Network error reaching api.x.ai. If your key is right, the browser may be blocking the call (CORS).'
    );
  }

  if (!response.ok) {
    throw new Error(await errorMessage(response, `xAI API error (HTTP ${response.status})`));
  }

  const { text, sources } = readResponse(await response.json());
  if (!text) throw new Error('Grok returned no output.');

  const opinion = normalizeTradeOpinion(extractJson(text));

  return { opinion, rawText: text, sources };
}

/** Smallest possible call that proves a key/model pair works (no search tools, so it is cheap). */
export async function verifyGrokConnection(config) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No API key entered.');
  const model = config.model || 'grok-4';

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model, input: 'Hi', max_output_tokens: 16 }),
    });
  } catch {
    throw new Error('Network error. Could not reach api.x.ai (the browser may be blocking it).');
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, `HTTP ${response.status}`));
  }
  await response.json();
  return { model };
}
