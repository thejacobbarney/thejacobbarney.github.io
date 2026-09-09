/**
 * Local-only persistence for the last computed report, so refreshing or
 * reopening the tab doesn't lose it. This is a plain localStorage cache —
 * nothing here talks to a network. Re-analyzing (or "Clear") overwrites or
 * removes it; there's no history, no cross-device sync, and no account —
 * see ARCHITECTURE.md §7 for why that's a deliberate choice, not a
 * placeholder for one.
 */

const STORAGE_KEY = 'pulse:last-summary:v1';

/** @returns {{ inventory: object, baselines: object, patterns: object, aiReport?: object } | null} */
export function loadCachedSummary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.summary?.inventory || !parsed?.summary?.baselines || !parsed?.summary?.patterns) return null;
    return parsed.summary;
  } catch (err) {
    console.error('Pulse: failed to load cached report.', err);
    return null;
  }
}

export function saveCachedSummary(summary) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ summary, savedAt: new Date().toISOString() }));
  } catch (err) {
    console.error('Pulse: failed to save report locally (storage full or unavailable).', err);
  }
}

export function clearCachedSummary() {
  localStorage.removeItem(STORAGE_KEY);
}
