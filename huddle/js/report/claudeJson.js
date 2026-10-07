/** One structured-output call to the Anthropic Messages API from the browser (bring-your-own-key). */

const API_URL = 'https://api.anthropic.com/v1/messages';

export async function callClaudeJson({ system, schema, input, config, maxTokens = 2048 }) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No Anthropic API key configured. Add one in the AI settings on My Team.');

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
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: JSON.stringify(input) }],
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
  if (data.stop_reason === 'refusal') throw new Error('The model declined to analyze this data.');
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The model returned no output.');
  return JSON.parse(textBlock.text);
}
