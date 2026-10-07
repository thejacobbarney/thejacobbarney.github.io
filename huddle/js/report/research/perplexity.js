/**
 * Perplexity (Sonar) live research, bring-your-own-key. Sonar models search the live web on every
 * request and return cited sources. Sends only the computed summaries the other AI features use,
 * never ESPN cookies or the raw ESPN response.
 *
 * Bearer auth against the OpenAI-style chat completions endpoint was confirmed working from a
 * browser (the connection test reached Perplexity and returned its own validation message). The
 * response field names are from memory (see ARCHITECTURE.md), so parsing is tolerant.
 */

import { RESEARCH_KINDS } from './kinds.js';
import { extractJson } from './normalize.js';

const API_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-pro';

const UNREADABLE =
  "Perplexity didn't answer in a way the browser can read. This usually means the key is invalid, revoked, or the account has no API credit (their error replies can leave out the headers browsers need). Copy a fresh key from your Perplexity API settings, check the account has credit, then Save and Test again.";

function keyProblem(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return 'No API key entered.';
  if (!key.startsWith('pplx-')) return 'That does not look like a Perplexity key. They start with pplx-. Check you copied the whole key and nothing else.';
  return null;
}

const authHeaders = (apiKey) => ({ 'content-type': 'application/json', authorization: `Bearer ${apiKey}` });

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

/**
 * @param {'trade'|'waiver'|'lineup'} kind
 * @param {object} summary
 * @param {{ apiKey: string, model?: string }} config
 * @returns {Promise<{ data: object|null, rawText: string, sources: string[] }>}
 */
export async function runPerplexity(kind, summary, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No Perplexity API key configured. Add one in the Perplexity settings on My Team.');
  const problem = keyProblem(apiKey);
  if (problem) throw new Error(problem);
  const { prompt, normalize } = RESEARCH_KINDS[kind];

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: JSON.stringify(summary) },
        ],
      }),
    });
  } catch {
    throw new Error(UNREADABLE);
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Perplexity API error (HTTP ${response.status})`));
  }
  const { text, sources } = readResponse(await response.json());
  if (!text) throw new Error('Perplexity returned no output.');
  return { data: normalize(extractJson(text)), rawText: text, sources };
}

/** Smallest possible call that proves a key/model pair works. Perplexity requires max_tokens >= 16. */
export async function verifyPerplexityConnection(config) {
  const apiKey = config?.apiKey;
  const problem = keyProblem(apiKey);
  if (problem) throw new Error(problem);
  const model = config.model || DEFAULT_MODEL;
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 16 }),
    });
  } catch {
    throw new Error(UNREADABLE);
  }
  if (!response.ok) throw new Error(await errorMessage(response, `HTTP ${response.status}`));
  await response.json();
  return { model };
}
