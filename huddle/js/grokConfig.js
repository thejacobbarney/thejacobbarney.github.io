/**
 * Grok (xAI) second-opinion configuration, bring-your-own-key. Kept apart
 * from aiConfig.js so the Anthropic and xAI keys can be set up, changed, or
 * removed independently. Same plain-localStorage tradeoff as aiConfig.js.
 */

const STORAGE_KEY = 'huddle:grok-config:v1';

const DEFAULTS = {
  enabled: false,
  apiKey: '',
  model: 'grok-4',
};

export function loadGrokConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Huddle: failed to load Grok config.', err);
    return { ...DEFAULTS };
  }
}

export function saveGrokConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, ...config }));
}

export function grokReady(config) {
  return Boolean(config && config.enabled && config.apiKey);
}
