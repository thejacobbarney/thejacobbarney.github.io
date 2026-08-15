/**
 * AI-assisted "Strengthen this experience" refinement (optional, BYOK).
 *
 * Sibling to aiResumeParser.js — same bring-your-own-key approach (direct
 * browser call to Anthropic, key from aiConfig.js), different task: turn
 * STAR notes into a single polished, impact-focused description instead of
 * parsing a document. Returns a plain string, the same return type as
 * experienceForm.js's offline `buildRefinedDescription()`, so the two are
 * interchangeable at the call site — the form just offers both as buttons.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT =
  "You turn a professional's raw STAR-method notes (Situation, Task, Action, Result) into a " +
  'single polished, impact-focused description suitable for a resume or portfolio entry. Use ' +
  'strong active verbs, quantify impact wherever a metric is given, and keep it to 2-4 sentences ' +
  "or a short bulleted list. Don't invent facts, numbers, or outcomes that aren't in the notes — " +
  'if a field is empty, just omit it rather than guessing. Respond with only the refined ' +
  'description text, nothing else — no preamble, no markdown headers, no surrounding quotes.';

/**
 * @param {{ title?: string, organization?: string, starSituation?: string,
 *   starTask?: string, starAction?: string, starResult?: string,
 *   metrics?: string }} fields
 * @param {{ apiKey: string, model?: string }} config
 * @returns {Promise<string>} the refined description text
 */
export async function refineExperienceWithAI(fields, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error('No Anthropic API key configured — add one in AI assistance settings.');
  }

  const context = [
    fields.title && `Title: ${fields.title}`,
    fields.organization && `Organization: ${fields.organization}`,
    fields.starSituation && `Situation: ${fields.starSituation}`,
    fields.starTask && `Task: ${fields.starTask}`,
    fields.starAction && `Action: ${fields.starAction}`,
    fields.starResult && `Result: ${fields.starResult}`,
    fields.metrics && `Metrics: ${fields.metrics}`,
  ]
    .filter(Boolean)
    .join('\n');

  if (!context) {
    throw new Error('Fill in at least one STAR field before asking for an AI refinement.');
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
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
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
    throw new Error('The model declined to refine this description.');
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('The model returned no output.');
  }
  return textBlock.text.trim();
}
