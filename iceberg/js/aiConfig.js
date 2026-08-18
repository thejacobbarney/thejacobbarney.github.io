/**
 * AI parsing configuration — bring-your-own-key.
 *
 * Iceberg is a static, backend-free site (see ARCHITECTURE.md), so there is
 * nowhere for an API key to live except the user's own browser. This module
 * is the one place that reads/writes the AI config to localStorage — the UI
 * (views/importResume.js) never touches localStorage directly.
 *
 * Security note surfaced to the user in the UI: localStorage is plain text,
 * readable by any script running on this page and by anyone with access to
 * this browser profile. That's an inherent tradeoff of a purely client-side
 * BYOK integration, not something this module can fix.
 */

const STORAGE_KEY = 'iceberg:ai-config:v1';

const DEFAULTS = {
  enabled: false,
  apiKey: '',
  model: 'claude-sonnet-5',
};

export function loadAiConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Iceberg: failed to load AI config.', err);
    return { ...DEFAULTS };
  }
}

export function saveAiConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, ...config }));
}
