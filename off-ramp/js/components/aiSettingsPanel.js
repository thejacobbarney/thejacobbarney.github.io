/**
 * Shared AI assistance settings panel (bring-your-own-key).
 *
 * Renders the enable checkbox + API key/model fields into any container,
 * backed by aiConfig.js (the single source of truth). Used by every
 * AI-assisted feature in the app (Import Resume, Strengthen This
 * Experience, ...) so the key/model only need to be entered once and every
 * feature shares the same on/off switch.
 *
 * TO EXTEND: a new AI-assisted feature should call `renderAiSettingsPanel`
 * the same way rather than building its own key-entry UI — see
 * views/importResume.js and views/experienceForm.js for the pattern.
 */

import { loadAiConfig, saveAiConfig } from '../aiConfig.js';
import { escapeHtml } from '../utils.js';

/**
 * @param {HTMLElement} container - emptied and filled with the panel.
 * @param {{ onChange?: (config: object) => void }} [options] - onChange
 *   fires after every edit (enable toggle or save) so the caller can
 *   re-evaluate anything that depends on the config, like a disabled
 *   button state.
 * @returns {object} the live config object — mutated in place by the
 *   panel's own event handlers, so callers can read `.enabled` / `.apiKey`
 *   / `.model` at any later point (e.g. when a button is clicked) without
 *   re-loading from storage.
 */
export function renderAiSettingsPanel(container, { onChange } = {}) {
  const config = loadAiConfig();

  container.innerHTML = `
    <fieldset class="ai-settings-panel">
      <legend>AI assistance (optional)</legend>
      <p class="muted">Off-ramp works fully offline by default. Turning this on sends text straight from this browser to Anthropic's API using your own key, for more capable results than the offline fallback. Your key is stored only in this browser's local storage — never on any server of ours — and Anthropic bills your account for usage at standard rates. Local storage isn't encrypted, so don't enable this on a shared computer.</p>
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
        <button type="button" class="btn ai-save-btn">Save AI settings</button>
        <span class="muted ai-save-status"></span>
      </div>
    </fieldset>
  `;

  const enabledCheckbox = container.querySelector('.ai-enabled');
  const fieldsEl = container.querySelector('.ai-fields');
  const apiKeyInput = container.querySelector('.ai-api-key');
  const modelInput = container.querySelector('.ai-model');
  const saveStatus = container.querySelector('.ai-save-status');
  const saveBtn = container.querySelector('.ai-save-btn');

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
    notify();
  });

  return config;
}
