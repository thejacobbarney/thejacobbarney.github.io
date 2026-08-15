/**
 * Import from Resume / LinkedIn View
 * ------------------------------------
 * Upload one or more documents (resume PDF/DOCX, a LinkedIn "Save to PDF"
 * export, an older resume version, plain text) and Off-ramp extracts
 * candidate Experience entries and candidate skills/tools for review.
 * Nothing touches the database until the user reviews, edits, and clicks
 * "Add Selected to Career Database" — review-before-commit is the safety
 * net that makes an imperfect parser useful instead of just noisy, for
 * either parsing path below.
 *
 * Two interchangeable parsing backends, both implementing the same
 * `(rawText, sourceLabel) -> { candidateExperiences, candidateSkills }`
 * contract (see resumeParser.js and aiResumeParser.js):
 *   - Offline heuristic (default) — parsers/resumeParser.js. No setup, no
 *     cost, works without network access.
 *   - AI-assisted, bring-your-own-key (opt-in) — parsers/aiResumeParser.js.
 *     Calls the Anthropic API directly from the browser with a key the
 *     user supplies and aiConfig.js persists to localStorage. More
 *     accurate on unusual layouts; costs the user's own API usage.
 *
 * TO EXTEND: this view only depends on `extractTextFromFile()` (raw text
 * out) and whichever parser is selected (candidates out) — swap either for
 * a smarter implementation later without touching the review/commit UI.
 */

import { addExperience, upsertSkill } from '../state.js';
import { EXPERIENCE_TYPES } from '../data-model.js';
import { extractTextFromFile } from '../parsers/textExtraction.js';
import { parseResumeText } from '../parsers/resumeParser.js';
import { parseResumeTextWithAI } from '../parsers/aiResumeParser.js';
import { loadAiConfig, saveAiConfig } from '../aiConfig.js';
import { escapeHtml } from '../utils.js';

let nextFileId = 1;

function statusLabel(f) {
  if (f.status === 'pending') return 'Ready to parse';
  if (f.status === 'parsing') return 'Parsing…';
  if (f.status === 'error') return `Error: ${f.error}`;
  if (f.status === 'parsed') return `Parsed — ${f.candidateCount} candidate experience(s) found`;
  return f.status;
}

export function render(root) {
  const files = [];
  let candidateExperiences = [];
  let candidateSkills = [];
  const excludedSkills = new Set();
  const aiConfig = loadAiConfig();

  const wrap = document.createElement('div');
  wrap.className = 'view';
  wrap.innerHTML = `
    <div class="view-header">
      <h1>Import from Resume / LinkedIn</h1>
    </div>
    <p class="muted">Upload a resume (PDF or DOCX), a LinkedIn "Save to PDF" export, or an old resume version — upload as many as you have. Off-ramp pulls out candidate roles and skills for you to review, edit, and add. Nothing is saved to your database until you approve it below.</p>

    <fieldset>
      <legend>AI-assisted parsing (optional)</legend>
      <p class="muted">By default Off-ramp uses a fast, offline heuristic parser — no setup, no cost. Turning this on sends the extracted document text straight from this browser to Anthropic's API using your own key, for more accurate extraction on documents with unusual layouts. Your key is stored only in this browser's local storage — never on any server of ours — and Anthropic bills your account for usage at standard rates. Local storage isn't encrypted, so don't enable this on a shared computer.</p>
      <label class="checkbox-label">
        <input type="checkbox" id="ai-enabled" ${aiConfig.enabled ? 'checked' : ''} /> Use AI-assisted parsing
      </label>
      <div id="ai-fields" style="${aiConfig.enabled ? '' : 'display:none;'}">
        <label>Anthropic API key
          <input type="password" id="ai-api-key" value="${escapeHtml(aiConfig.apiKey)}" placeholder="sk-ant-…" autocomplete="off" />
        </label>
        <label>Model (advanced, optional)
          <input type="text" id="ai-model" value="${escapeHtml(aiConfig.model)}" />
        </label>
        <button type="button" id="ai-save-btn" class="btn">Save AI settings</button>
        <span class="muted" id="ai-save-status"></span>
      </div>
    </fieldset>

    <input type="file" id="file-input" accept=".pdf,.docx,.txt,.md" multiple />
    <div id="file-list"></div>
    <button type="button" id="parse-btn" class="btn" disabled>Parse Files</button>

    <div id="review-section"></div>
  `;
  root.appendChild(wrap);

  const fileInput = wrap.querySelector('#file-input');
  const fileListEl = wrap.querySelector('#file-list');
  const parseBtn = wrap.querySelector('#parse-btn');
  const reviewEl = wrap.querySelector('#review-section');

  const aiEnabledCheckbox = wrap.querySelector('#ai-enabled');
  const aiFieldsEl = wrap.querySelector('#ai-fields');
  const aiApiKeyInput = wrap.querySelector('#ai-api-key');
  const aiModelInput = wrap.querySelector('#ai-model');
  const aiSaveStatus = wrap.querySelector('#ai-save-status');

  aiEnabledCheckbox.addEventListener('change', () => {
    aiConfig.enabled = aiEnabledCheckbox.checked;
    aiFieldsEl.style.display = aiConfig.enabled ? '' : 'none';
    saveAiConfig(aiConfig);
    drawFileList();
  });

  wrap.querySelector('#ai-save-btn').addEventListener('click', () => {
    aiConfig.apiKey = aiApiKeyInput.value.trim();
    aiConfig.model = aiModelInput.value.trim() || 'claude-opus-5';
    saveAiConfig(aiConfig);
    aiSaveStatus.textContent = 'Saved.';
    drawFileList();
  });

  function drawFileList() {
    fileListEl.innerHTML = '';
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <span class="file-row-name">${escapeHtml(f.file.name)}</span>
        <span class="file-row-status status-${f.status}">${escapeHtml(statusLabel(f))}</span>
        <button type="button" data-remove-file="${f.id}" ${f.status === 'parsing' ? 'disabled' : ''}>Remove</button>
      `;
      fileListEl.appendChild(row);
    }
    const aiBlocked = aiConfig.enabled && !aiConfig.apiKey;
    parseBtn.disabled = aiBlocked || files.length === 0 || !files.some((f) => f.status === 'pending');
    parseBtn.title = aiBlocked ? 'Add and save an Anthropic API key above, or turn off AI-assisted parsing.' : '';
  }

  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) {
      files.push({ id: nextFileId++, file, status: 'pending', error: '', candidateCount: 0 });
    }
    fileInput.value = '';
    drawFileList();
  });

  fileListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove-file]');
    if (!btn) return;
    const id = Number(btn.dataset.removeFile);
    const idx = files.findIndex((f) => f.id === id);
    if (idx >= 0) files.splice(idx, 1);
    drawFileList();
  });

  parseBtn.addEventListener('click', async () => {
    parseBtn.disabled = true;
    for (const f of files) {
      if (f.status !== 'pending') continue;
      f.status = 'parsing';
      drawFileList();
      try {
        const text = await extractTextFromFile(f.file);
        const parsed = aiConfig.enabled
          ? await parseResumeTextWithAI(text, f.file.name, aiConfig)
          : parseResumeText(text, f.file.name);
        candidateExperiences.push(...parsed.candidateExperiences);
        for (const skill of parsed.candidateSkills) {
          if (!candidateSkills.some((existing) => existing.toLowerCase() === skill.toLowerCase())) {
            candidateSkills.push(skill);
          }
        }
        f.status = 'parsed';
        f.candidateCount = parsed.candidateExperiences.length;
      } catch (err) {
        f.status = 'error';
        f.error = err.message;
      }
      drawFileList();
    }
    drawReview();
  });

  function drawReview() {
    if (candidateExperiences.length === 0 && candidateSkills.length === 0) {
      reviewEl.innerHTML =
        '<p class="empty-state">No candidate experiences or skills were found in the parsed file(s). Try a different file, or add experiences manually.</p>';
      return;
    }

    reviewEl.innerHTML = `
      <h2>Review candidate experiences (${candidateExperiences.length})</h2>
      <p class="muted">Uncheck anything you don't want, edit any field, then add the rest to your career database.</p>
      <div id="candidate-list"></div>
      ${
        candidateSkills.length
          ? `<h2>Review candidate skills &amp; tools (${candidateSkills.length})</h2>
             <p class="muted">Click a chip to exclude it.</p>
             <div class="tag-list" id="candidate-skills"></div>`
          : ''
      }
      <div class="form-actions">
        <button type="button" id="commit-btn" class="btn">Add Selected to Career Database</button>
        <span class="muted" id="commit-status"></span>
      </div>
    `;

    const listEl = reviewEl.querySelector('#candidate-list');
    candidateExperiences.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'experience-card candidate-card';
      card.dataset.index = String(i);
      card.innerHTML = `
        <label class="checkbox-label">
          <input type="checkbox" class="c-toggle" checked /> Import this experience
        </label>
        <div class="row">
          <label>Title <input class="c-title" value="${escapeHtml(c.title)}" /></label>
          <label>Organization <input class="c-org" value="${escapeHtml(c.organization)}" /></label>
        </div>
        <div class="row">
          <label>Start <input type="date" class="c-start" value="${escapeHtml(c.startDate)}" /></label>
          <label>End <input type="date" class="c-end" value="${escapeHtml(c.endDate)}" /></label>
          <label class="checkbox-label"><input type="checkbox" class="c-ongoing" ${c.isOngoing ? 'checked' : ''} /> Ongoing</label>
          <label>Type
            <select class="c-type">
              ${EXPERIENCE_TYPES.map((t) => `<option value="${t.value}" ${t.value === c.type ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </label>
        </div>
        <label>Description <textarea class="c-desc" rows="3">${escapeHtml(c.originalDescription)}</textarea></label>
        <details>
          <summary>Show raw extracted text</summary>
          <pre class="raw-text">${escapeHtml(c.sourceText)}</pre>
        </details>
        <p class="muted">Source: ${escapeHtml(c.sourceLabel)}</p>
      `;
      listEl.appendChild(card);
    });

    const skillsEl = reviewEl.querySelector('#candidate-skills');
    if (skillsEl) {
      excludedSkills.clear();
      for (const skill of candidateSkills) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag skill-chip-toggle';
        chip.textContent = skill;
        chip.addEventListener('click', () => {
          if (excludedSkills.has(skill)) {
            excludedSkills.delete(skill);
            chip.classList.remove('excluded');
          } else {
            excludedSkills.add(skill);
            chip.classList.add('excluded');
          }
        });
        skillsEl.appendChild(chip);
      }
    }

    reviewEl.querySelector('#commit-btn').addEventListener('click', (e) => {
      let addedExperiences = 0;
      listEl.querySelectorAll('.candidate-card').forEach((card) => {
        if (!card.querySelector('.c-toggle').checked) return;
        const sourceLabel = candidateExperiences[Number(card.dataset.index)].sourceLabel;
        addExperience({
          title: card.querySelector('.c-title').value.trim(),
          organization: card.querySelector('.c-org').value.trim(),
          startDate: card.querySelector('.c-start').value,
          endDate: card.querySelector('.c-end').value,
          isOngoing: card.querySelector('.c-ongoing').checked,
          type: card.querySelector('.c-type').value,
          originalDescription: card.querySelector('.c-desc').value,
          source: 'imported',
          notes: `Imported from "${sourceLabel}" — review and refine.`,
        });
        addedExperiences++;
      });

      let addedSkills = 0;
      for (const skill of candidateSkills) {
        if (excludedSkills.has(skill)) continue;
        upsertSkill({ name: skill, category: 'technical' });
        addedSkills++;
      }

      reviewEl.querySelector('#commit-status').innerHTML =
        `Added ${addedExperiences} experience(s) and ${addedSkills} skill(s). <a href="#dashboard">View in dashboard &rarr;</a>`;
      candidateExperiences = [];
      candidateSkills = [];
      e.target.disabled = true;
    });
  }
}
