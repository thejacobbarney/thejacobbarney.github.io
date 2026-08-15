/**
 * Dashboard / Timeline View
 * -------------------------
 * Chronological list of every Experience with search + filters. This is the
 * default landing view.
 *
 * TO EXTEND: additional filter dimensions (e.g. "linked to resume only",
 * "organization") just need a new control here plus a matching predicate
 * in `applyFilters()`. To turn this into a true visual timeline later,
 * swap the card-list rendering in `draw()` for a date-axis layout — the
 * filtering/sorting logic underneath doesn't need to change.
 */

import { getAllExperiences, deleteExperience } from '../state.js';
import { EXPERIENCE_TYPES } from '../data-model.js';
import { formatDateRange, escapeHtml } from '../utils.js';

function applyFilters(experiences, filters) {
  const { search, type, skill } = filters;
  return experiences.filter((exp) => {
    if (type && exp.type !== type) return false;
    if (skill) {
      const needle = skill.toLowerCase();
      const haystack = [...exp.skillsHard, ...exp.skillsSoft, ...exp.tools, ...exp.tags].map((s) =>
        s.toLowerCase()
      );
      if (!haystack.some((s) => s.includes(needle))) return false;
    }
    if (search) {
      const needle = search.toLowerCase();
      const haystack = [
        exp.title,
        exp.organization,
        exp.originalDescription,
        exp.refinedDescription,
        exp.metrics,
        exp.notes,
        ...exp.tags,
        ...exp.skillsHard,
        ...exp.skillsSoft,
        ...exp.tools,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function sortByDateDesc(experiences) {
  return [...experiences].sort((a, b) => {
    const aKey = a.endDate || a.startDate || '';
    const bKey = b.endDate || b.startDate || '';
    return bKey.localeCompare(aKey);
  });
}

function typeLabel(value) {
  return EXPERIENCE_TYPES.find((t) => t.value === value)?.label || value;
}

export function render(root) {
  const filters = { search: '', type: '', skill: '' };

  const wrap = document.createElement('div');
  wrap.className = 'view';
  wrap.innerHTML = `
    <div class="view-header">
      <h1>All Experiences</h1>
      <a class="btn" href="#add">+ Add Experience</a>
    </div>
    <form class="filter-bar" id="filter-bar">
      <input type="search" name="search" placeholder="Search all text fields…" />
      <select name="type">
        <option value="">All types</option>
        ${EXPERIENCE_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
      </select>
      <input type="text" name="skill" placeholder="Filter by skill / tool / tag…" />
    </form>
    <p class="muted" id="result-count"></p>
    <div id="experience-list"></div>
  `;
  root.appendChild(wrap);

  const list = wrap.querySelector('#experience-list');
  const countEl = wrap.querySelector('#result-count');
  const form = wrap.querySelector('#filter-bar');

  function draw() {
    const filtered = sortByDateDesc(applyFilters(getAllExperiences(), filters));
    countEl.textContent = `${filtered.length} experience${filtered.length === 1 ? '' : 's'}`;
    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML =
        '<p class="empty-state">No experiences match. Try clearing filters, or add a new one.</p>';
      return;
    }
    for (const exp of filtered) {
      const card = document.createElement('article');
      card.className = 'experience-card';
      const skillTags = [...exp.skillsHard, ...exp.skillsSoft, ...exp.tools]
        .map((s) => `<span class="tag">${escapeHtml(s)}</span>`)
        .join('');
      card.innerHTML = `
        <div class="experience-card-header">
          <div>
            <h3>${escapeHtml(exp.title) || '(untitled)'}</h3>
            <p class="muted">${escapeHtml(exp.organization)} · ${escapeHtml(formatDateRange(exp))} · ${escapeHtml(typeLabel(exp.type))}${exp.linkedToResume ? ' · on resume' : ''}</p>
          </div>
          <div class="experience-card-actions">
            <a href="#edit-${exp.id}">Edit</a>
            <button type="button" data-delete="${exp.id}">Delete</button>
          </div>
        </div>
        <p>${escapeHtml(exp.refinedDescription || exp.originalDescription) || '<em>No description yet.</em>'}</p>
        ${exp.metrics ? `<p class="metrics">${escapeHtml(exp.metrics)}</p>` : ''}
        <div class="tag-list">${skillTags}</div>
      `;
      list.appendChild(card);
    }
  }

  form.addEventListener('input', () => {
    const fd = new FormData(form);
    filters.search = fd.get('search') || '';
    filters.type = fd.get('type') || '';
    filters.skill = fd.get('skill') || '';
    draw();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-delete]');
    if (!btn) return;
    if (confirm('Delete this experience? This cannot be undone.')) {
      deleteExperience(btn.dataset.delete);
      draw();
    }
  });

  draw();
}
