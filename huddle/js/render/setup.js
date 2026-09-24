import { loadConfig, saveConfig, clearConfig } from '../storage.js';
import { escapeHtml } from '../utils.js';

/**
 * Renders the settings form into `root` and wires it up. Calls
 * `onSaved(config)` once a valid config is saved.
 */
export function renderSetup(root, { onSaved }) {
  const c = loadConfig() || { workerUrl: '', leagueId: '', year: String(new Date().getFullYear()), teamId: '', swid: '', espnS2: '' };

  root.innerHTML = `
    <section class="card setup-card">
      <h2>Connect your league</h2>
      <p class="muted">Everything here is saved only in this browser (localStorage) and sent only to the Worker URL you provide below — never to any other server.</p>

      <label class="field">
        <span>Worker URL</span>
        <input type="url" id="f-worker" placeholder="https://your-worker.your-subdomain.workers.dev" value="${escapeHtml(c.workerUrl)}" />
        <span class="field-hint">Your deployed ESPN proxy. See ARCHITECTURE.md for the one-time setup.</span>
      </label>

      <label class="field">
        <span>League ID</span>
        <input type="text" inputmode="numeric" id="f-league" placeholder="e.g. 123456" value="${escapeHtml(c.leagueId)}" />
        <span class="field-hint">From your league URL: fantasy.espn.com/football/team?leagueId=<b>THIS</b>&amp;teamId=…</span>
      </label>

      <label class="field">
        <span>Season year</span>
        <input type="text" inputmode="numeric" id="f-year" value="${escapeHtml(c.year)}" />
      </label>

      <label class="field">
        <span>Your team ID</span>
        <input type="text" inputmode="numeric" id="f-team" placeholder="e.g. 4" value="${escapeHtml(c.teamId)}" />
        <span class="field-hint">Same URL, the number after teamId=</span>
      </label>

      <div class="field-divider">Private league? Add these two (optional for public leagues)</div>

      <label class="field">
        <span>SWID</span>
        <input type="text" id="f-swid" placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" value="${escapeHtml(c.swid)}" />
      </label>

      <label class="field">
        <span>espn_s2</span>
        <input type="text" id="f-s2" placeholder="long encoded string" value="${escapeHtml(c.espnS2)}" />
        <span class="field-hint">Both come from your browser's cookies for fantasy.espn.com while logged in.</span>
      </label>

      <p id="setup-error" class="error-text"></p>

      <div class="setup-actions">
        <button type="button" id="setup-save" class="btn">Save &amp; Connect</button>
        <button type="button" id="setup-clear" class="btn btn-ghost">Clear saved data</button>
      </div>
    </section>
  `;

  root.querySelector('#setup-save').addEventListener('click', () => {
    const config = {
      workerUrl: root.querySelector('#f-worker').value.trim().replace(/\/+$/, ''),
      leagueId: root.querySelector('#f-league').value.trim(),
      year: root.querySelector('#f-year').value.trim(),
      teamId: root.querySelector('#f-team').value.trim(),
      swid: root.querySelector('#f-swid').value.trim(),
      espnS2: root.querySelector('#f-s2').value.trim(),
    };
    const errEl = root.querySelector('#setup-error');
    if (!config.workerUrl || !config.leagueId || !config.year || !config.teamId) {
      errEl.textContent = 'Worker URL, League ID, Year, and Team ID are all required.';
      return;
    }
    try {
      new URL(config.workerUrl);
    } catch {
      errEl.textContent = 'Worker URL doesn\'t look like a valid URL.';
      return;
    }
    errEl.textContent = '';
    saveConfig(config);
    onSaved(config);
  });

  root.querySelector('#setup-clear').addEventListener('click', () => {
    clearConfig();
    renderSetup(root, { onSaved });
  });
}
