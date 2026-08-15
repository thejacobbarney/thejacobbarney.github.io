/**
 * Experience Capture & Refinement Form
 * -------------------------------------
 * One form handles both "add new" (no id in the route) and "edit existing"
 * (#edit-<id>). It also hosts the "Strengthen this experience" flow: a
 * STAR-prompt panel that assembles Situation/Task/Action/Result + metrics
 * into a fuller, impact-focused refined description.
 *
 * TO EXTEND: to swap the STAR assembly for a real AI call later, replace
 * `buildRefinedDescription()` with an async function, await its result in
 * the button handler below, and write it into the textarea — nothing else
 * in this form (or the data model) needs to change.
 */

import { getExperience, addExperience, updateExperience } from '../state.js';
import { createExperience, EXPERIENCE_TYPES } from '../data-model.js';
import { parseListInput, escapeHtml } from '../utils.js';

function buildRefinedDescription({ starSituation, starTask, starAction, starResult, metrics }) {
  const parts = [];
  if (starSituation) parts.push(starSituation.trim());
  if (starTask) parts.push(`Task: ${starTask.trim()}`);
  if (starAction) parts.push(`Action: ${starAction.trim()}`);
  if (starResult) parts.push(`Result: ${starResult.trim()}`);
  if (metrics) parts.push(`Impact: ${metrics.trim()}`);
  return parts.join(' ');
}

export function render(root, params) {
  const editingId = params?.id || null;
  const existing = editingId ? getExperience(editingId) : null;
  const exp = existing || createExperience();
  const e = (val) => escapeHtml(val); // local alias for readability below

  const wrap = document.createElement('div');
  wrap.className = 'view';
  wrap.innerHTML = `
    <div class="view-header">
      <h1>${existing ? 'Edit Experience' : 'Add Experience'}</h1>
      <a class="btn-link" href="#dashboard">&larr; Back to all experiences</a>
    </div>

    <form id="exp-form">
      <fieldset>
        <legend>The basics</legend>
        <label>Title / short name
          <input name="title" required value="${e(exp.title)}" />
        </label>
        <label>Organization / company (optional)
          <input name="organization" value="${e(exp.organization)}" />
        </label>
        <div class="row">
          <label>Start date
            <input type="date" name="startDate" value="${e(exp.startDate)}" />
          </label>
          <label>End date
            <input type="date" name="endDate" value="${e(exp.endDate)}" />
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="isOngoing" ${exp.isOngoing ? 'checked' : ''} /> Ongoing
          </label>
        </div>
        <label>Type
          <select name="type">
            ${EXPERIENCE_TYPES.map(
              (t) => `<option value="${t.value}" ${t.value === exp.type ? 'selected' : ''}>${t.label}</option>`
            ).join('')}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Quick capture</legend>
        <label>Original description — what I wrote / remember at the time
          <textarea name="originalDescription" rows="3">${e(exp.originalDescription)}</textarea>
        </label>
      </fieldset>

      <fieldset>
        <legend>Strengthen this experience (STAR)</legend>
        <p class="muted">Optional — fill in what applies, then click "Assemble refined description" to draft a fuller, impact-focused version below. Edit the result by hand afterward.</p>
        <label>Situation — what was the context / problem?
          <textarea name="starSituation" rows="2">${e(exp.starSituation)}</textarea>
        </label>
        <label>Task — what were you responsible for?
          <textarea name="starTask" rows="2">${e(exp.starTask)}</textarea>
        </label>
        <label>Action — what did you specifically do?
          <textarea name="starAction" rows="2">${e(exp.starAction)}</textarea>
        </label>
        <label>Result — what happened?
          <textarea name="starResult" rows="2">${e(exp.starResult)}</textarea>
        </label>
        <label>Quantifiable results / metrics
          <input name="metrics" value="${e(exp.metrics)}" placeholder="e.g. cut cycle time 30%, saved $2M annually" />
        </label>
        <button type="button" id="assemble-btn">Assemble refined description &darr;</button>
        <label>Refined / impact-focused description
          <textarea name="refinedDescription" rows="4">${e(exp.refinedDescription)}</textarea>
        </label>
      </fieldset>

      <fieldset>
        <legend>Skills, tools &amp; tags</legend>
        <label>Hard / technical skills demonstrated (comma-separated)
          <input name="skillsHard" value="${e(exp.skillsHard.join(', '))}" />
        </label>
        <label>Soft skills demonstrated (comma-separated)
          <input name="skillsSoft" value="${e(exp.skillsSoft.join(', '))}" />
        </label>
        <label>Tools / technologies / systems used (comma-separated)
          <input name="tools" value="${e(exp.tools.join(', '))}" />
        </label>
        <label>Tags / keywords (comma-separated)
          <input name="tags" value="${e(exp.tags.join(', '))}" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Notes &amp; status</legend>
        <label>Notes / context / lessons learned
          <textarea name="notes" rows="3">${e(exp.notes)}</textarea>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" name="linkedToResume" ${exp.linkedToResume ? 'checked' : ''} />
          Linked to current resume
        </label>
      </fieldset>

      <div class="form-actions">
        <button type="submit" class="btn">${existing ? 'Save Changes' : 'Add Experience'}</button>
      </div>
    </form>
  `;
  root.appendChild(wrap);

  const form = wrap.querySelector('#exp-form');

  wrap.querySelector('#assemble-btn').addEventListener('click', () => {
    const fd = new FormData(form);
    const refined = buildRefinedDescription({
      starSituation: fd.get('starSituation'),
      starTask: fd.get('starTask'),
      starAction: fd.get('starAction'),
      starResult: fd.get('starResult'),
      metrics: fd.get('metrics'),
    });
    form.querySelector('[name="refinedDescription"]').value = refined;
  });

  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const fd = new FormData(form);
    const fields = {
      title: (fd.get('title') || '').trim(),
      organization: (fd.get('organization') || '').trim(),
      startDate: fd.get('startDate') || '',
      endDate: fd.get('endDate') || '',
      isOngoing: fd.get('isOngoing') === 'on',
      type: fd.get('type') || 'job',
      originalDescription: fd.get('originalDescription') || '',
      refinedDescription: fd.get('refinedDescription') || '',
      starSituation: fd.get('starSituation') || '',
      starTask: fd.get('starTask') || '',
      starAction: fd.get('starAction') || '',
      starResult: fd.get('starResult') || '',
      metrics: fd.get('metrics') || '',
      skillsHard: parseListInput(fd.get('skillsHard')),
      skillsSoft: parseListInput(fd.get('skillsSoft')),
      tools: parseListInput(fd.get('tools')),
      tags: parseListInput(fd.get('tags')),
      notes: fd.get('notes') || '',
      linkedToResume: fd.get('linkedToResume') === 'on',
    };
    if (existing) {
      updateExperience(existing.id, fields);
    } else {
      addExperience(fields);
    }
    location.hash = '#dashboard';
  });
}
