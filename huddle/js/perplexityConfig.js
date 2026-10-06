/**
 * Perplexity second-opinion configuration, bring-your-own-key. Separate from
 * aiConfig.js and grokConfig.js so each provider can be set up or removed
 * independently. Same plain-localStorage tradeoff as those.
 */

const STORAGE_KEY = 'huddle:perplexity-config:v1';

const DEFAULTS = {
  enabled: false,
  apiKey: '',
  model: 'sonar-pro',
};

export function loadPerplexityConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Huddle: failed to load Perplexity config.', err);
    return { ...DEFAULTS };
  }
}

export function savePerplexityConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, ...config }));
}

export function perplexityReady(config) {
  return Boolean(config && config.enabled && config.apiKey);
}
