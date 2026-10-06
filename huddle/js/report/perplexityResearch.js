/**
 * Perplexity (Sonar) second opinion on trades and waiver moves, bring-your-own-key.
 * Sonar models search the live web on every request, so this is the "what is the
 * latest news on these players" check next to the offline numbers.
 *
 * Sends the same computed summaries the other AI features do, never ESPN cookies or
 * the raw ESPN response. Request/response shapes follow Perplexity's OpenAI-style
 * chat completions API (Bearer auth, `citations` alongside the choices). They were
 * written without live access to Perplexity's docs or API (see ARCHITECTURE.md), so
 * parsing is tolerant and errors surface Perplexity's own message.
 */

import { GRADES } from '../trade.js';
import { TRADE_SYSTEM_PROMPT, extractJson, normalizeTradeOpinion } from './grokTrade.js';

const API_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-pro';

const WAIVER_SYSTEM_PROMPT = `You are an expert fantasy football analyst checking waiver-wire moves for an ESPN fantasy football team.

You are given a JSON summary: the user's roster (position, recent scoring average, this week's projection, injury status, bye week, and a season log of weekly points so far), a list of add/drop suggestions already computed from projected points, and the top available free agents by position.

Use your live search before answering. For every player in a suggested move (both the add and the drop), search the web for the latest injury reports, practice participation, snap-count, target or carry share changes, depth-chart moves, and credible beat-reporter news. Say how fresh each item is and whether it is confirmed, reported, or rumor. Judge whether an added player's production looks like a real role or a one-week fluke.

Rules:
- Every number about this season must come from the provided summary. Numbers from search results must be labeled as such.
- Never recommend dropping a player solely because he is OUT, QUESTIONABLE, or on a bye this single week. Check his season log and recent average first, and prefer holding an elite player through a short injury.
- If a player's status in the summary conflicts with what you find, trust the search and say so.
- You may name better pickups only from the available free agents list in the summary. Do not invent players.
- Keep it tight. This is read on a phone before submitting a claim.

Respond with ONLY a single JSON object, no markdown fences, in exactly this shape:
{
  "headline": "one or two sentence bottom line",
  "moves": [ { "add": "player name", "drop": "player name", "verdict": "go" | "wait" | "skip", "grade": "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "D-" | "F", "newsOnAdd": "latest news and role trend", "newsOnDrop": "latest news and long-term value", "reasoning": "why this verdict" } ],
  "betterTargets": [ { "name": "free agent name from the list", "why": "short reason" } ],
  "notes": [ "anything else worth knowing" ]
}`;

const asArray = (v) => (Array.isArray(v) ? v : []);

function authHeaders(apiKey) {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

async function errorMessage(response, fallback) {
  if (response.status === 401) return 'Invalid Perplexity API key.';
  try {
    const body = await response.json();
    const msg = body?.error?.message || body?.error || body?.message;
    if (typeof msg === 'string' && msg) return msg;
  } catch {
    // Keep the generic message if the error body isn't JSON.
  }
  return fallback;
}

function readResponse(data) {
  let text = data?.choices?.[0]?.message?.content;
  text = typeof text === 'string' ? text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
  const urls = [];
  for (const c of data?.citations || []) {
    if (typeof c === 'string') urls.push(c);
    else if (typeof c?.url === 'string') urls.push(c.url);
  }
  for (const r of data?.search_results || []) {
    if (typeof r?.url === 'string') urls.push(r.url);
  }
  const sources = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 8);
  return { text, sources };
}

async function callPerplexity(systemPrompt, summary, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No Perplexity API key configured. Add one in the Perplexity settings on My Team.');
  }
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(summary) },
        ],
      }),
    });
  } catch {
    throw new Error(
      'Network error reaching api.perplexity.ai. If your key is right, the browser may be blocking the call (CORS).'
    );
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Perplexity API error (HTTP ${response.status})`));
  }
  const { text, sources } = readResponse(await response.json());
  if (!text) throw new Error('Perplexity returned no output.');
  return { text, sources };
}

/** @returns {Promise<{ opinion: object|null, rawText: string, sources: string[] }>} */
export async function generatePerplexityTradeOpinion(summary, config) {
  const { text, sources } = await callPerplexity(TRADE_SYSTEM_PROMPT, summary, config);
  return { opinion: normalizeTradeOpinion(extractJson(text)), rawText: text, sources };
}

/** @returns {Promise<{ check: object|null, rawText: string, sources: string[] }>} */
export async function generatePerplexityWaiverCheck(summary, config) {
  const { text, sources } = await callPerplexity(WAIVER_SYSTEM_PROMPT, summary, config);
  const p = extractJson(text);
  const check = p
    ? {
        headline: String(p.headline || ''),
        moves: asArray(p.moves).map((m) => ({
          add: String(m?.add ?? ''),
          drop: String(m?.drop ?? ''),
          verdict: ['go', 'wait', 'skip'].includes(m?.verdict) ? m.verdict : null,
          grade: GRADES.includes(m?.grade) ? m.grade : null,
          newsOnAdd: String(m?.newsOnAdd ?? ''),
          newsOnDrop: String(m?.newsOnDrop ?? ''),
          reasoning: String(m?.reasoning ?? ''),
        })),
        betterTargets: asArray(p.betterTargets).map((t) => ({ name: String(t?.name ?? ''), why: String(t?.why ?? '') })),
        notes: asArray(p.notes).map(String),
      }
    : null;
  return { check, rawText: text, sources };
}

/** Smallest possible call that proves a key/model pair works. */
export async function verifyPerplexityConnection(config) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No API key entered.');
  const model = config.model || DEFAULT_MODEL;
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 8 }),
    });
  } catch {
    throw new Error('Network error. Could not reach api.perplexity.ai (the browser may be blocking it).');
  }
  if (!response.ok) throw new Error(await errorMessage(response, `HTTP ${response.status}`));
  await response.json();
  return { model };
}
