/**
 * Persistence layer — the ONLY module that talks to localStorage.
 *
 * TO SWAP IN A REAL BACKEND LATER:
 *   Replace the bodies of `loadData()` / `saveData()` with fetch() calls to
 *   an API (make them async and update state.js's callers to await them).
 *   Every view only calls state.js, never storage.js directly, so the swap
 *   is isolated to these two functions plus the export/import pair below.
 */

import { createEmptyDataset } from './data-model.js';

const STORAGE_KEY = 'offramp:data:v1';

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyDataset();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.experiences) || !Array.isArray(parsed.skills)) {
      return createEmptyDataset();
    }
    return parsed;
  } catch (err) {
    console.error('Off-ramp: failed to load saved data, starting fresh.', err);
    return createEmptyDataset();
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Serializes the dataset for download as a .json file. */
export function exportToJsonString(data) {
  return JSON.stringify(data, null, 2);
}

/**
 * Parses and lightly validates an imported JSON string. Throws on
 * structurally invalid input so the caller can show an error instead of
 * silently corrupting the store.
 */
export function importFromJsonString(jsonString) {
  const parsed = JSON.parse(jsonString);
  if (!parsed || !Array.isArray(parsed.experiences) || !Array.isArray(parsed.skills)) {
    throw new Error('File does not look like an Off-ramp export (missing experiences/skills arrays).');
  }
  return parsed;
}
