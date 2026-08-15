/**
 * App entry point / router.
 *
 * A tiny hash-based router: the URL hash decides which view module renders
 * into #view-root. There is no build step and no framework — each view
 * module exports a single `render(root, params)` function that owns its
 * own DOM and event listeners.
 *
 * TO ADD A NEW VIEW: write a views/yourview.js exporting render(root),
 * add a case to `parseRoute()` below, and add a nav link in index.html
 * pointing at the matching hash.
 */

import { render as renderDashboard } from './views/dashboard.js';
import { render as renderExperienceForm } from './views/experienceForm.js';
import { render as renderSkills } from './views/skills.js';
import { render as renderMatch } from './views/match.js';
import { render as renderExportImport } from './views/exportImport.js';

const root = document.getElementById('view-root');

function parseRoute(hash) {
  const clean = hash.replace(/^#\/?/, '');
  if (clean.startsWith('edit-')) {
    return { view: renderExperienceForm, params: { id: clean.slice('edit-'.length) } };
  }
  switch (clean) {
    case 'add':
      return { view: renderExperienceForm, params: {} };
    case 'skills':
      return { view: renderSkills, params: {} };
    case 'match':
      return { view: renderMatch, params: {} };
    case 'export':
      return { view: renderExportImport, params: {} };
    case 'dashboard':
    default:
      return { view: renderDashboard, params: {} };
  }
}

function setActiveNav(hash) {
  const normalized = hash.startsWith('#edit-') ? '#dashboard' : hash;
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === normalized);
  });
}

function renderRoute() {
  const hash = location.hash || '#dashboard';
  const { view, params } = parseRoute(hash);
  root.innerHTML = '';
  view(root, params);
  setActiveNav(hash);
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
