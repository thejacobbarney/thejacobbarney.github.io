/**
 * Shared AI game-plan settings panel (bring-your-own-key). Renders the
 * enable checkbox + API key/model fields into any container, backed by
 * aiConfig.js — same contract as Pulse's/Iceberg's aiSettingsPanel.js.
 */

import { loadAiConfig, saveAiConfig } from '../aiConfig.js';
import { verifyAiConnection } from '../aiVerify.js';
import { escapeHtml } from '../utils.js';

export function renderAiSettingsPanel(container, { onChange } = {}) {
  const config = loadAiConfig();

  container.innerHTML = `
    <fieldset class="ai-settings-panel">
      <legend>AI game plan (optional)</legend>
      <p class="muted small">Huddle computes every start/sit and waiver comparison in this browser, fully offline. Turning this on additionally sends that computed summary — your roster, matchup, and suggested moves, never your ESPN cookies or league credentials — straight from this browser to Anthropic's API using your own key, to write an actual game plan instead of a bare list of point deltas. Your key is stored only in this browser's local storage and Anthropic bills your account at standard rates. Local storage isn't encrypted, so don't enable this on a shared device.</p>
      <label class="checkbox-label">
        <input type="checkbox" class="ai-enabled" ${config.enabled ? 'checked' : ''} /> Use AI assistance
      </label>
      <div class="ai-fields" style="${config.enabled ? '' : 'display:none;'}">
        <label>Anthropic API key
          <input type="password" class="ai-api-key" value="${escapeHtml(config.apiKey)}" placeholder="sk-ant-…" autocomplete="off" />
        </label>
        <label>Model (advanced, optional)
          <input type="text" class="ai-model" value="${escapeHtml(config.model)}" />
        </label>
        <div class="row">
          <button type="button" class="btn ai-save-btn">Save AI settings</button>
          <button type="button" class="btn-ghost ai-test-btn">Test connection</button>
        </div>
        <span class="muted ai-save-status"></span>
        <span class="muted ai-test-status"></span>
      </div>
    </fieldset>
  `;

  const enabledCheckbox = container.querySelector('.ai-enabled');
  const fieldsEl = container.querySelector('.ai-fields');
  const apiKeyInput = container.querySelector('.ai-api-key');
  const modelInput = container.querySelector('.ai-model');
  const saveStatus = container.querySelector('.ai-save-status');
  const saveBtn = container.querySelector('.ai-save-btn');
  const testBtn = container.querySelector('.ai-test-btn');
  const testStatus = container.querySelector('.ai-test-status');

  function notify() {
    if (onChange) onChange(config);
  }

  enabledCheckbox.addEventListener('change', () => {
    config.enabled = enabledCheckbox.checked;
    fieldsEl.style.display = config.enabled ? '' : 'none';
    saveAiConfig(config);
    notify();
  });

  saveBtn.addEventListener('click', () => {
    config.apiKey = apiKeyInput.value.trim();
    config.model = modelInput.value.trim() || 'claude-sonnet-5';
    saveAiConfig(config);
    saveStatus.textContent = 'Saved.';
    testStatus.textContent = '';
    testStatus.className = 'muted ai-test-status';
    notify();
  });

  testBtn.addEventListener('click', async () => {
    const testConfig = {
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || 'claude-sonnet-5',
    };
    testBtn.disabled = true;
    testStatus.textContent = 'Testing…';
    testStatus.className = 'muted ai-test-status';
    try {
      await verifyAiConnection(testConfig);
      testStatus.textContent = '✓ Connected';
      testStatus.className = 'muted ai-test-status status-success';
    } catch (err) {
      testStatus.textContent = `✗ ${err.message}`;
      testStatus.className = 'muted ai-test-status status-error';
    } finally {
      testBtn.disabled = false;
    }
  });

  return config;
}
