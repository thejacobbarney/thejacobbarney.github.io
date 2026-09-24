// Everything here is local-only: the league config (including ESPN cookies,
// if the league is private) lives in this browser's localStorage and is
// sent only to the Worker URL the person themselves configured — never to
// any third party, never synced. Same posture as Pulse's reportCache.js.

const CONFIG_KEY = 'huddle:config:v1';

/** @typedef {{ workerUrl: string, leagueId: string, year: string, teamId: string, swid: string, espnS2: string }} HuddleConfig */

/** @returns {HuddleConfig | null} */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @param {HuddleConfig} config */
export function saveConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Private-browsing / storage-disabled: config just won't persist across reloads.
  }
}

export function clearConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    // Nothing to do if storage isn't available.
  }
}

export function hasConfig() {
  const c = loadConfig();
  return !!(c && c.workerUrl && c.leagueId && c.year && c.teamId);
}
