/**
 * AI connection verification (bring-your-own-key).
 *
 * Sends the smallest possible Anthropic Messages API request to confirm a
 * key/model pair actually works, so the settings panel can show "connected"
 * before the user relies on it inside a real parse/refine call. Same direct
 * browser-to-Anthropic approach as aiResumeParser.js / aiRefine.js — see
 * ARCHITECTURE.md §6.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * @param {{ apiKey: string, model?: string }} config
 * @returns {Promise<{ model: string }>} resolves on a successful round trip
 * @throws {Error} with a human-readable message on any failure
 */
export async function verifyAiConnection(config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No API key entered.');
  }

  const model = config.model || 'claude-sonnet-5';

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
  } catch {
    throw new Error('Network error — could not reach api.anthropic.com.');
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    if (response.status === 401) {
      message = 'Invalid API key.';
    } else if (response.status === 404) {
      message = `Model "${model}" not found.`;
    } else {
      try {
        const body = await response.json();
        if (body?.error?.message) message = body.error.message;
      } catch {
        // Keep the generic message if the error body isn't JSON.
      }
    }
    throw new Error(message);
  }

  await response.json();
  return { model };
}
