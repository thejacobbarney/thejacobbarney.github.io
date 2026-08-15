/**
 * Skills & Tools Inventory View
 * ------------------------------
 * Lists every Skill/Tool record — auto-registered whenever an experience
 * tags a new skill/tool name, or added manually here — grouped by category,
 * with links back to the experiences that developed it.
 *
 * TO EXTEND: proficiency scoring, endorsement counts, etc. can be added as
 * new fields in data-model.js's createSkill() and rendered in the row
 * markup below.
 */

import { getAllSkills, getExperiencesForSkill, upsertSkill, deleteSkill } from '../state.js';
import { SKILL_CATEGORIES } from '../data-model.js';
import { escapeHtml } from '../utils.js';

export function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'view';
  wrap.innerHTML = `
    <div class="view-header">
      <h1>Skills &amp; Tools Inventory</h1>
    </div>
    <form id="add-skill-form" class="inline-form">
      <input name="name" placeholder="Add a skill/tool by name…" required />
      <select name="category">
        ${SKILL_CATEGORIES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('')}
      </select>
      <button type="submit" class="btn">Add</button>
    </form>
    <div id="skill-groups"></div>
  `;
  root.appendChild(wrap);

  const groupsEl = wrap.querySelector('#skill-groups');

  function draw() {
    const skills = [...getAllSkills()].sort((a, b) => a.name.localeCompare(b.name));
    groupsEl.innerHTML = '';
    if (skills.length === 0) {
      groupsEl.innerHTML =
        '<p class="empty-state">No skills yet — they appear automatically as you tag experiences, or add one above.</p>';
      return;
    }
    for (const category of SKILL_CATEGORIES) {
      const inCategory = skills.filter((s) => s.category === category.value);
      if (inCategory.length === 0) continue;
      const section = document.createElement('section');
      section.className = 'skill-group';
      section.innerHTML = `<h2>${category.label}</h2>`;
      const table = document.createElement('div');
      table.className = 'skill-table';
      for (const skill of inCategory) {
        const relatedExperiences = getExperiencesForSkill(skill.name);
        const row = document.createElement('div');
        row.className = 'skill-row';
        row.innerHTML = `
          <div class="skill-row-name">${escapeHtml(skill.name)}</div>
          <div class="skill-row-count">${relatedExperiences.length} experience${relatedExperiences.length === 1 ? '' : 's'}</div>
          <div class="skill-row-links">
            ${
              relatedExperiences
                .map((exp) => `<a href="#edit-${exp.id}">${escapeHtml(exp.title) || '(untitled)'}</a>`)
                .join(', ') || '<span class="muted">not yet linked</span>'
            }
          </div>
          <button type="button" data-delete-skill="${skill.id}" title="Remove from inventory (does not touch experiences)">&times;</button>
        `;
        table.appendChild(row);
      }
      section.appendChild(table);
      groupsEl.appendChild(section);
    }
  }

  wrap.querySelector('#add-skill-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    const name = (fd.get('name') || '').trim();
    if (!name) return;
    upsertSkill({ name, category: fd.get('category') });
    evt.target.reset();
    draw();
  });

  groupsEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-delete-skill]');
    if (!btn) return;
    deleteSkill(btn.dataset.deleteSkill);
    draw();
  });

  draw();
}
