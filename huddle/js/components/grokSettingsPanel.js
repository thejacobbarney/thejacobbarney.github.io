/**
 * Grok (xAI) settings panel (bring-your-own-key), backed by grokConfig.js.
 * Same collapsed-once-configured behavior as aiSettingsPanel.js.
 */

import { loadGrokConfig, saveGrokConfig, grokReady } from '../grokConfig.js';
import { verifyGrokConnection } from '../report/grokTrade.js';
import { escapeHtml } from '../utils.js';

export function renderGrokSettingsPanel(container, { onChange } = {}) {
  const config = loadGrokConfig();
  const alreadySetUp = grokReady(config);

  container.innerHTML = `
    <details class="ai-settings-panel" ${alreadySetUp ? '' : 'open'}>
      <summary>Grok second opinion (optional)${alreadySetUp ? ' <span class="muted small">· configured</span>' : ''}</summary>
      <div class="ai-settings-body">
        <p class="muted small">On the Trade tab, Grok (xAI) can give a second opinion that searches the live web and X for injury and performance news on the players in a trade, recalls their prior-season history, and critiques the Claude analysis if you ran one. It sends the trade summary (both rosters and the players moving) straight from this browser to xAI using your own key, never your ESPN cookies or league credentials. The key is stored only in this browser's local storage, and xAI bills your account for the search tool calls. Local storage isn't encrypted, so don't enable this on a shared device.</p>
        <label class="checkbox-label">
          <input type="checkbox" class="grok-enabled" ${config.enabled ? 'checked' : ''} /> Use Grok
        </label>
        <div class="grok-fields" style="${config.enabled ? '' : 'display:none;'}">
          <label>xAI API key
            <input type="password" class="grok-api-key" value="${escapeHtml(config.apiKey)}" placeholder="xai-…" autocomplete="off" />
          </label>
          <label>Model (advanced, optional)
            <input type="text" class="grok-model" value="${escapeHtml(config.model)}" />
          </label>
          <div class="row">
            <button type="button" class="btn grok-save-btn">Save Grok settings</button>
            <button type="button" class="btn-ghost grok-test-btn">Test connection</button>
          </div>
          <span class="muted grok-save-status"></span>
          <span class="muted grok-test-status"></span>
        </div>
      </div>
    </details>
  `;

  const enabledCheckbox = container.querySelector('.grok-enabled');
  const fieldsEl = container.querySelector('.grok-fields');
  const apiKeyInput = container.querySelector('.grok-api-key');
  const modelInput = container.querySelector('.grok-model');
  const saveStatus = container.querySelector('.grok-save-status');
  const saveBtn = container.querySelector('.grok-save-btn');
  const testBtn = container.querySelector('.grok-test-btn');
  const testStatus = container.querySelector('.grok-test-status');

  const notify = () => onChange && onChange(config);

  enabledCheckbox.addEventListener('change', () => {
    config.enabled = enabledCheckbox.checked;
    fieldsEl.style.display = config.enabled ? '' : 'none';
    saveGrokConfig(config);
    notify();
  });

  saveBtn.addEventListener('click', () => {
    config.apiKey = apiKeyInput.value.trim();
    config.model = modelInput.value.trim() || 'grok-4';
    saveGrokConfig(config);
    saveStatus.textContent = 'Saved.';
    testStatus.textContent = '';
    testStatus.className = 'muted grok-test-status';
    notify();
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testStatus.textContent = 'Testing…';
    testStatus.className = 'muted grok-test-status';
    try {
      await verifyGrokConnection({
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim() || 'grok-4',
      });
      testStatus.textContent = '✓ Connected';
      testStatus.className = 'muted grok-test-status status-success';
    } catch (err) {
      testStatus.textContent = `✗ ${err.message}`;
      testStatus.className = 'muted grok-test-status status-error';
    } finally {
      testBtn.disabled = false;
    }
  });

  return config;
}
