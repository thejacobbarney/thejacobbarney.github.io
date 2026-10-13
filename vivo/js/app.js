import { parseFile, mergeParsedFiles } from './parsers/fileParser.js';
import { buildInventory } from './analysis/inventory.js';
import { buildBaselines } from './analysis/baselines.js';
import { buildPatterns } from './analysis/patterns.js';
import { renderAiSettingsPanel } from './components/aiSettingsPanel.js';
import { vivoMarkSvg } from './components/logoMark.js';
import { loadAiConfig } from './aiConfig.js';
import { generateAiReport } from './report/aiReport.js';
import { loadCachedSummary, saveCachedSummary, clearCachedSummary } from './reportCache.js';
import { startConnect, isConnected, isRelayConfigured, disconnect as disconnectWhoop } from './whoopAuth.js';
import { fetchWhoopData } from './parsers/whoopApi.js';
import { escapeHtml, formatDate } from './utils.js';
import { NAV_ITEMS, VIEW_RENDERERS } from './dashboard/views.js';
import { icons } from './dashboard/icons.js';

// ── Logo marks ────────────────────────────────────────────────
document.querySelectorAll('.logo-mount').forEach((el) => {
  el.innerHTML = vivoMarkSvg(Number(el.dataset.size) || 28);
});

// ── Landing DOM refs ──────────────────────────────────────────
const landingViewEl = document.getElementById('landing-view');
const fileInput = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const analyzeBtn = document.getElementById('analyze-btn');
const errorEl = document.getElementById('upload-error');
const whoopConnectBtn = document.getElementById('whoop-connect-btn');
const whoopDisconnectedBlock = document.getElementById('whoop-disconnected-block');
const whoopConnectedBlock = document.getElementById('whoop-connected-block');
const whoopSyncBtn = document.getElementById('whoop-sync-btn');
const whoopDisconnectBtn = document.getElementById('whoop-disconnect-btn');
const whoopErrorEl = document.getElementById('whoop-error');
const whoopSectionEl = document.getElementById('whoop-section');

// ── Dashboard DOM refs ────────────────────────────────────────
const dashboardViewEl = document.getElementById('dashboard-view');
const dashboardContentRoot = document.getElementById('dashboard-content-root');
const restoredBannerEl = document.getElementById('restored-banner');
const dismissRestoredBtn = document.getElementById('dismiss-restored-btn');
const sidebarEl = document.getElementById('sidebar');
const sidebarNavEl = document.getElementById('sidebar-nav');
const navScrimEl = document.getElementById('nav-scrim');
const mobileNavToggle = document.getElementById('mobile-nav-toggle');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const topbarGreetingEl = document.getElementById('topbar-greeting');
const topbarRangeEl = document.getElementById('topbar-range');
const newUploadBtn = document.getElementById('new-upload-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');

const dashWhoopSectionEl = document.getElementById('dashboard-whoop-section');
const dashWhoopConnectBtn = document.getElementById('dashboard-whoop-connect-btn');
const dashWhoopDisconnectedBlock = document.getElementById('dashboard-whoop-disconnected-block');
const dashWhoopConnectedBlock = document.getElementById('dashboard-whoop-connected-block');
const dashWhoopSyncBtn = document.getElementById('dashboard-whoop-sync-btn');
const dashWhoopDisconnectBtn = document.getElementById('dashboard-whoop-disconnect-btn');
const dashWhoopErrorEl = document.getElementById('dashboard-whoop-error');

mobileNavToggle.innerHTML = icons.menu;
sidebarCloseBtn.innerHTML = icons.close;

let selectedFiles = [];
let lastSummary = null; // { inventory, baselines, patterns, records, aiReport? }
let activeView = 'overview';
let aiConfig = loadAiConfig();

// ── Sidebar nav ───────────────────────────────────────────────

sidebarNavEl.innerHTML = NAV_ITEMS.map(
  (item) => `<button type="button" class="nav-item" data-view="${item.key}">${icons[item.icon] || ''}<span>${escapeHtml(item.label)}</span></button>`
).join('');

sidebarNavEl.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveView(btn.dataset.view);
    closeMobileNav();
  });
});

function setActiveView(view) {
  activeView = view;
  sidebarNavEl.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  renderActiveView();
}

function renderActiveView() {
  if (!lastSummary) return;
  const renderer = VIEW_RENDERERS[activeView] || VIEW_RENDERERS.overview;
  dashboardContentRoot.innerHTML = renderer(lastSummary);
  if (activeView === 'leverage') wireLeverageView();
}

function openMobileNav() {
  sidebarEl.classList.add('open');
  navScrimEl.hidden = false;
}
function closeMobileNav() {
  sidebarEl.classList.remove('open');
  navScrimEl.hidden = true;
}
mobileNavToggle.addEventListener('click', openMobileNav);
sidebarCloseBtn.addEventListener('click', closeMobileNav);
navScrimEl.addEventListener('click', closeMobileNav);

// ── Leverage view: AI settings panel + generate button ───────

function wireLeverageView() {
  const mount = document.getElementById('leverage-ai-panel-mount');
  const generateBtn = document.getElementById('generate-ai-btn');
  const statusEl = document.getElementById('generate-ai-status');
  if (!mount || !generateBtn) return;

  aiConfig = renderAiSettingsPanel(mount, { onChange: (cfg) => syncAiButton(cfg, generateBtn) });
  syncAiButton(aiConfig, generateBtn);

  generateBtn.addEventListener('click', async () => {
    if (!lastSummary) return;
    const cfg = loadAiConfig();
    generateBtn.disabled = true;
    statusEl.textContent = 'Generating leverage points and protocol…';
    statusEl.className = 'muted';
    try {
      const aiReport = await generateAiReport(lastSummary, cfg);
      lastSummary = { ...lastSummary, aiReport };
      saveCachedSummary(lastSummary);
      renderActiveView();
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      statusEl.className = 'muted status-error';
      generateBtn.disabled = false;
    }
  });
}

function syncAiButton(cfg, generateBtn) {
  aiConfig = cfg;
  generateBtn.hidden = !(lastSummary && cfg.enabled && cfg.apiKey);
}

// ── Landing <-> dashboard transitions ────────────────────────

function showLanding() {
  landingViewEl.hidden = false;
  dashboardViewEl.hidden = true;
}

function showDashboard() {
  landingViewEl.hidden = true;
  dashboardViewEl.hidden = false;
  closeMobileNav();
  updateTopbar();
  setActiveView('overview');
}

function updateTopbar() {
  if (!lastSummary) return;
  const { inventory } = lastSummary;
  topbarGreetingEl.textContent = 'Good to see you.';
  topbarRangeEl.textContent =
    inventory.startDate && inventory.endDate ? `${formatDate(inventory.startDate)} – ${formatDate(inventory.endDate)}` : '';
}

newUploadBtn.addEventListener('click', () => {
  showLanding();
});

clearCacheBtn.addEventListener('click', () => {
  clearCachedSummary();
  lastSummary = null;
  showLanding();
});

dismissRestoredBtn.addEventListener('click', () => {
  restoredBannerEl.hidden = true;
});

// ── Shared: parsedFiles -> computed summary -> dashboard ─────

function analyzeParsedFiles(parsedFiles) {
  const records = mergeParsedFiles(parsedFiles);
  const inventory = buildInventory(parsedFiles, records);
  const baselines = buildBaselines(records);
  if (baselines.averages.hrv && inventory.hrvMetric && inventory.hrvMetric !== 'unspecified') {
    baselines.averages.hrv.label += ` (${inventory.hrvMetric})`;
  }
  const patterns = buildPatterns(records, baselines);
  lastSummary = { inventory, baselines, patterns, records };
  saveCachedSummary(lastSummary);
  restoredBannerEl.hidden = true;
  showDashboard();
}

// ── CSV/JSON upload ───────────────────────────────────────────

fileInput.addEventListener('change', () => {
  selectedFiles = Array.from(fileInput.files || []);
  renderFileList();
  analyzeBtn.disabled = selectedFiles.length === 0;
});

function renderFileList() {
  if (selectedFiles.length === 0) {
    fileListEl.innerHTML = '';
    return;
  }
  fileListEl.innerHTML = selectedFiles
    .map((f) => `<li>${escapeHtml(f.name)} <span class="muted">(${Math.round(f.size / 1024)} KB)</span></li>`)
    .join('');
}

analyzeBtn.addEventListener('click', async () => {
  errorEl.textContent = '';
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing…';

  try {
    const parsedFiles = [];
    const parseErrors = [];
    for (const file of selectedFiles) {
      try {
        parsedFiles.push(await parseFile(file));
      } catch (err) {
        parseErrors.push(err.message);
      }
    }
    if (parsedFiles.length === 0) {
      throw new Error(parseErrors.join(' ') || 'No files could be parsed.');
    }

    analyzeParsedFiles(parsedFiles);
    if (parseErrors.length) {
      errorEl.textContent = `Some files were skipped: ${parseErrors.join(' ')}`;
    }
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze My Data';
  }
});

// ── Whoop connect / sync / disconnect ────────────────────────
// Mirrored across two UI locations: the landing page (first connect) and
// the dashboard sidebar (manage an existing connection) — both reflect the
// same underlying state from whoopAuth.js.

function syncWhoopUi() {
  const configured = isRelayConfigured();
  whoopSectionEl.hidden = !configured;
  dashWhoopSectionEl.hidden = !configured;
  if (!configured) return;

  const connected = isConnected();
  whoopDisconnectedBlock.hidden = connected;
  whoopConnectedBlock.hidden = !connected;
  dashWhoopDisconnectedBlock.hidden = connected;
  dashWhoopConnectedBlock.hidden = !connected;
}

whoopConnectBtn.addEventListener('click', () => startConnect());
dashWhoopConnectBtn.addEventListener('click', () => startConnect());

whoopDisconnectBtn.addEventListener('click', () => {
  disconnectWhoop();
  syncWhoopUi();
});
dashWhoopDisconnectBtn.addEventListener('click', () => {
  disconnectWhoop();
  syncWhoopUi();
});

async function syncWhoopData({ fromDashboard = false } = {}) {
  const targetErrorEl = fromDashboard ? dashWhoopErrorEl : whoopErrorEl;
  const targetBtn = fromDashboard ? dashWhoopSyncBtn : whoopSyncBtn;
  targetErrorEl.textContent = '';
  targetBtn.disabled = true;
  targetBtn.textContent = 'Syncing…';
  try {
    const { parsedFiles, warnings } = await fetchWhoopData();
    analyzeParsedFiles(parsedFiles);
    if (warnings.length) {
      dashWhoopErrorEl.textContent = warnings.join(' ');
    }
  } catch (err) {
    targetErrorEl.textContent = err.message;
  } finally {
    targetBtn.disabled = false;
    targetBtn.textContent = fromDashboard ? 'Sync' : 'Sync Whoop Data';
  }
}

whoopSyncBtn.addEventListener('click', () => syncWhoopData({ fromDashboard: false }));
dashWhoopSyncBtn.addEventListener('click', () => syncWhoopData({ fromDashboard: true }));

syncWhoopUi();

// ── Startup: Whoop return, or restore cached report ──────────

const justConnected = new URLSearchParams(window.location.search).get('whoop') === 'connected';
if (justConnected) {
  window.history.replaceState({}, '', window.location.pathname);
  syncWhoopUi();
  syncWhoopData({ fromDashboard: true });
} else {
  const cached = loadCachedSummary();
  if (cached) {
    lastSummary = cached;
    showDashboard();
    restoredBannerEl.hidden = false;
  } else {
    showLanding();
  }
}
