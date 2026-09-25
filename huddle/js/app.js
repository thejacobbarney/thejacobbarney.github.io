import { loadConfig, hasConfig } from './storage.js';
import { fetchLeague, fetchFreeAgents, normalizeLeague, normalizeFreeAgents } from './espnClient.js';
import { renderSetup } from './render/setup.js';
import { renderMyTeam } from './render/myTeam.js';
import { renderMatchup } from './render/matchup.js';
import { renderStandings } from './render/standings.js';
import { renderWaiver } from './render/waiver.js';
import { renderOutlook } from './render/outlook.js';

const appRoot = document.getElementById('app-root');
const tabBar = document.getElementById('tab-bar');
const settingsBtn = document.getElementById('settings-btn');
const refreshBtn = document.getElementById('refresh-btn');
const statusEl = document.getElementById('status-line');

const CACHE_KEY = 'huddle:cache:v2';
const TABS = {
  team: { label: 'My Team', render: renderMyTeam },
  matchup: { label: 'Matchup', render: renderMatchup },
  waiver: { label: 'Waivers', render: renderWaiver },
  outlook: { label: 'Outlook', render: renderOutlook },
  standings: { label: 'Standings', render: renderStandings },
};

let currentLeague = null;
let activeTab = 'team';

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCache(league) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ league, savedAt: Date.now() }));
  } catch {
    // best-effort only
  }
}

function showTabBar(show) {
  tabBar.hidden = !show;
  refreshBtn.hidden = !show;
}

function renderActiveTab() {
  if (!currentLeague) return;
  TABS[activeTab].render(appRoot, currentLeague);
  [...tabBar.children].forEach((btn) => btn.classList.toggle('tab-active', btn.dataset.tab === activeTab));
}

function buildTabBar() {
  tabBar.innerHTML = Object.entries(TABS)
    .map(([key, t]) => `<button type="button" class="tab-btn" data-tab="${key}">${t.label}</button>`)
    .join('');
  tabBar.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderActiveTab();
    });
  });
}

async function loadLeague({ silent } = {}) {
  const config = loadConfig();
  if (!silent) {
    statusEl.textContent = 'Loading your league…';
  }
  try {
    const raw = await fetchLeague(config);
    currentLeague = normalizeLeague(raw, config);
    showTabBar(true);
    renderActiveTab();

    // Free agents are a separate ESPN request — let the rest of the app work
    // even if this one fails (e.g. the deployed Worker predates waiver support).
    try {
      const rawFreeAgents = await fetchFreeAgents(config, { week: currentLeague.week });
      currentLeague.freeAgents = normalizeFreeAgents(rawFreeAgents, currentLeague.week);
    } catch (faErr) {
      currentLeague.freeAgents = null;
      currentLeague.freeAgentsError = faErr.message;
    }

    saveCache(currentLeague);
    statusEl.textContent = '';
    renderActiveTab();
  } catch (err) {
    if (!currentLeague) {
      appRoot.innerHTML = `<div class="card"><p class="error-text">${err.message}</p></div>`;
    }
    statusEl.textContent = `✗ ${err.message}`;
  }
}

function goToSetup() {
  showTabBar(false);
  statusEl.textContent = '';
  renderSetup(appRoot, {
    onSaved: () => {
      buildTabBar();
      loadLeague();
    },
  });
}

settingsBtn.addEventListener('click', goToSetup);
refreshBtn.addEventListener('click', () => loadLeague());

if (hasConfig()) {
  buildTabBar();
  const cached = loadCache();
  if (cached) {
    currentLeague = cached.league;
    showTabBar(true);
    renderActiveTab();
    const mins = Math.round((Date.now() - cached.savedAt) / 60000);
    statusEl.textContent = `Showing cached data (${mins < 1 ? 'just now' : mins + 'm ago'}), refreshing…`;
  }
  loadLeague({ silent: !!cached });
} else {
  goToSetup();
}
