/**
 * Export / Import View
 * ----------------------
 * The whole dataset lives in localStorage; this view is the escape hatch —
 * download it as JSON (backup, move to another browser) and restore it.
 *
 * TO EXTEND: to export polished resume/LinkedIn-ready text later, add a
 * second export button here that formats getAllExperiences() as
 * text/markdown instead of raw JSON — the underlying data doesn't change.
 */

import { getDataset, replaceDataset } from '../state.js';
import { exportToJsonString, importFromJsonString } from '../storage.js';

export function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'view';
  wrap.innerHTML = `
    <div class="view-header">
      <h1>Export / Import</h1>
    </div>
    <section>
      <h2>Export</h2>
      <p class="muted">Download the full dataset (experiences + skills) as a JSON file. Keep it as a backup or move it to another browser/device.</p>
      <button type="button" id="export-btn" class="btn">Download JSON</button>
    </section>
    <section>
      <h2>Import</h2>
      <p class="muted">Restore from a previously exported JSON file. This replaces everything currently stored in this browser.</p>
      <input type="file" id="import-file" accept="application/json" />
      <p id="import-status" class="muted"></p>
    </section>
  `;
  root.appendChild(wrap);

  wrap.querySelector('#export-btn').addEventListener('click', () => {
    const json = exportToJsonString(getDataset());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iceberg-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const statusEl = wrap.querySelector('#import-status');
  wrap.querySelector('#import-file').addEventListener('change', async (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = importFromJsonString(text);
      const confirmed = confirm(
        `Import ${parsed.experiences.length} experience(s) and ${parsed.skills.length} skill(s)? This replaces all current data.`
      );
      if (!confirmed) return;
      replaceDataset(parsed);
      statusEl.textContent = 'Import successful.';
    } catch (err) {
      statusEl.textContent = `Import failed: ${err.message}`;
    }
    evt.target.value = '';
  });
}
