/**
 * Grok (xAI) live research, bring-your-own-key. Grok searches the web and X itself, so this is
 * the "latest news on these players" check next to the offline numbers. Sends only the computed
 * summaries the other AI features use, never ESPN cookies or the raw ESPN response.
 *
 * Request/response shapes follow xAI's Responses API with its built-in web_search and x_search
 * tools. They were written without live access to xAI's docs or API (see ARCHITECTURE.md), so
 * parsing is tolerant and errors surface xAI's own message.
 */

import { RESEARCH_KINDS } from './kinds.js';
import { extractJson } from './normalize.js';

const API_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4';

const authHeaders = (apiKey) => ({ 'content-type': 'application/json', authorization: `Bearer ${apiKey}` });

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
  const sources = [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 8);
  return { text: texts.join('\n').trim(), sources };
}

/**
 * @param {'trade'|'waiver'|'lineup'} kind
 * @param {object} summary
 * @param {{ apiKey: string, model?: string }} config
 * @returns {Promise<{ data: object|null, rawText: string, sources: string[] }>}
 */
export async function runGrok(kind, summary, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No xAI API key configured. Add one in the Grok settings on My Team.');
  const { prompt, normalize } = RESEARCH_KINDS[kind];

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        input: [
          { role: 'system', content: prompt },
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
  if (!response.ok) throw new Error(await errorMessage(response, `xAI API error (HTTP ${response.status})`));

  const { text, sources } = readResponse(await response.json());
  if (!text) throw new Error('Grok returned no output.');
  return { data: normalize(extractJson(text)), rawText: text, sources };
}

/** Smallest possible call that proves a key/model pair works (no search tools, so it is cheap). */
export async function verifyGrokConnection(config) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No API key entered.');
  const model = config.model || DEFAULT_MODEL;
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
  if (!response.ok) throw new Error(await errorMessage(response, `HTTP ${response.status}`));
  await response.json();
  return { model };
}
