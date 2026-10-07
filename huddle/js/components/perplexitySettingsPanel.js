/**
 * Perplexity settings panel (bring-your-own-key), backed by perplexityConfig.js.
 * Same collapsed-once-configured behavior as aiSettingsPanel.js.
 */

import { loadPerplexityConfig, savePerplexityConfig, perplexityReady } from '../perplexityConfig.js';
import { verifyPerplexityConnection } from '../report/research/perplexity.js';
import { escapeHtml } from '../utils.js';

export function renderPerplexitySettingsPanel(container, { onChange } = {}) {
  const config = loadPerplexityConfig();
  const alreadySetUp = perplexityReady(config);

  container.innerHTML = `
    <details class="ai-settings-panel" ${alreadySetUp ? '' : 'open'}>
      <summary>Perplexity live research (optional)${alreadySetUp ? ' <span class="muted small">· configured</span>' : ''}</summary>
      <div class="ai-settings-body">
        <p class="muted small">On the Trade and Waivers tabs, Perplexity can search the live web for the latest injury, role, and performance news on the players involved and write a second opinion with sources. It sends the trade or waiver summary (rosters, the players in the move, and top free agents) straight from this browser to Perplexity using your own key, never your ESPN cookies or league credentials. The key is stored only in this browser's local storage, and Perplexity bills your account per request. Local storage isn't encrypted, so don't enable this on a shared device.</p>
        <label class="checkbox-label">
          <input type="checkbox" class="perplexity-enabled" ${config.enabled ? 'checked' : ''} /> Use Perplexity
        </label>
        <div class="perplexity-fields" style="${config.enabled ? '' : 'display:none;'}">
          <label>Perplexity API key
            <input type="password" class="perplexity-api-key" value="${escapeHtml(config.apiKey)}" placeholder="pplx-…" autocomplete="off" />
          </label>
          <label>Model (advanced, optional)
            <input type="text" class="perplexity-model" value="${escapeHtml(config.model)}" />
          </label>
          <div class="row">
            <button type="button" class="btn perplexity-save-btn">Save Perplexity settings</button>
            <button type="button" class="btn-ghost perplexity-test-btn">Test connection</button>
          </div>
          <span class="muted perplexity-save-status"></span>
          <span class="muted perplexity-test-status"></span>
        </div>
      </div>
    </details>
  `;

  const enabledCheckbox = container.querySelector('.perplexity-enabled');
  const fieldsEl = container.querySelector('.perplexity-fields');
  const apiKeyInput = container.querySelector('.perplexity-api-key');
  const modelInput = container.querySelector('.perplexity-model');
  const saveStatus = container.querySelector('.perplexity-save-status');
  const saveBtn = container.querySelector('.perplexity-save-btn');
  const testBtn = container.querySelector('.perplexity-test-btn');
  const testStatus = container.querySelector('.perplexity-test-status');

  const notify = () => onChange && onChange(config);

  enabledCheckbox.addEventListener('change', () => {
    config.enabled = enabledCheckbox.checked;
    fieldsEl.style.display = config.enabled ? '' : 'none';
    savePerplexityConfig(config);
    notify();
  });

  saveBtn.addEventListener('click', () => {
    config.apiKey = apiKeyInput.value.trim();
    config.model = modelInput.value.trim() || 'perplexity-4';
    savePerplexityConfig(config);
    saveStatus.textContent = 'Saved.';
    testStatus.textContent = '';
    testStatus.className = 'muted perplexity-test-status';
    notify();
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testStatus.textContent = 'Testing…';
    testStatus.className = 'muted perplexity-test-status';
    try {
      await verifyPerplexityConnection({
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim() || 'perplexity-4',
      });
      testStatus.textContent = '✓ Connected';
      testStatus.className = 'muted perplexity-test-status status-success';
    } catch (err) {
      testStatus.textContent = `✗ ${err.message}`;
      testStatus.className = 'muted perplexity-test-status status-error';
    } finally {
      testBtn.disabled = false;
    }
  });

  return config;
}
