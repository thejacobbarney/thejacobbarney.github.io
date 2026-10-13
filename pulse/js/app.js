import { parseFile, mergeParsedFiles } from './parsers/fileParser.js';
import { buildInventory } from './analysis/inventory.js';
import { buildBaselines } from './analysis/baselines.js';
import { buildPatterns } from './analysis/patterns.js';
import { renderReport } from './report/renderReport.js';
import { renderVitalsBar } from './report/renderVitals.js';
import { renderAiSettingsPanel } from './components/aiSettingsPanel.js';
import { loadAiConfig } from './aiConfig.js';
import { generateAiReport } from './report/aiReport.js';
import { loadCachedSummary, saveCachedSummary, clearCachedSummary } from './reportCache.js';
import { startConnect, isConnected, isRelayConfigured, disconnect as disconnectWhoop } from './whoopAuth.js';
import { fetchWhoopData } from './parsers/whoopApi.js';
import { escapeHtml } from './utils.js';

const fileInput = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const analyzeBtn = document.getElementById('analyze-btn');
const errorEl = document.getElementById('upload-error');
const aiPanelEl = document.getElementById('ai-settings-panel-container');
const restoredBannerEl = document.getElementById('restored-banner');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const vitalsStripEl = document.getElementById('vitals-strip');
const reportEl = document.getElementById('report-root');
const generateAiBtn = document.getElementById('generate-ai-btn');
const aiStatusEl = document.getElementById('generate-ai-status');
const whoopConnectBtn = document.getElementById('whoop-connect-btn');
const whoopDisconnectedBlock = document.getElementById('whoop-disconnected-block');
const whoopConnectedBlock = document.getElementById('whoop-connected-block');
const whoopSyncBtn = document.getElementById('whoop-sync-btn');
const whoopDisconnectBtn = document.getElementById('whoop-disconnect-btn');
const whoopErrorEl = document.getElementById('whoop-error');
const whoopSectionEl = document.getElementById('whoop-section');

let selectedFiles = [];
let lastSummary = null;
let aiConfig = renderAiSettingsPanel(aiPanelEl, { onChange: (cfg) => syncAiButton(cfg) });

function syncAiButton(cfg) {
  aiConfig = cfg;
  generateAiBtn.hidden = !(lastSummary && cfg.enabled && cfg.apiKey);
}

/** Renders the vitals strip + report body from a summary, and updates the AI button. Does not touch the cache. */
function renderSummary(summary) {
  lastSummary = summary;
  const vitalsHtml = renderVitalsBar(summary.baselines);
  vitalsStripEl.innerHTML = vitalsHtml;
  vitalsStripEl.hidden = !vitalsHtml;
  reportEl.innerHTML = renderReport(summary);
  syncAiButton(aiConfig);
}

function clearReportUi() {
  reportEl.innerHTML = '';
  vitalsStripEl.hidden = true;
  vitalsStripEl.innerHTML = '';
  restoredBannerEl.hidden = true;
  generateAiBtn.hidden = true;
  aiStatusEl.textContent = '';
}

/** Shared by the CSV-upload path and the Whoop-sync path: parsedFiles -> computed summary -> rendered + cached. */
function analyzeParsedFiles(parsedFiles) {
  const records = mergeParsedFiles(parsedFiles);
  const inventory = buildInventory(parsedFiles, records);
  const baselines = buildBaselines(records);
  if (baselines.averages.hrv && inventory.hrvMetric && inventory.hrvMetric !== 'unspecified') {
    baselines.averages.hrv.label += ` (${inventory.hrvMetric})`;
  }
  const patterns = buildPatterns(records, baselines);
  renderSummary({ inventory, baselines, patterns });
  saveCachedSummary(lastSummary);
}

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
  clearReportUi();
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
    reportEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze My Data';
  }
});

generateAiBtn.addEventListener('click', async () => {
  if (!lastSummary) return;
  const cfg = loadAiConfig();
  generateAiBtn.disabled = true;
  aiStatusEl.textContent = 'Generating leverage points and protocol…';
  aiStatusEl.className = 'muted';
  try {
    const aiReport = await generateAiReport(lastSummary, cfg);
    renderSummary({ ...lastSummary, aiReport });
    saveCachedSummary(lastSummary);
    aiStatusEl.textContent = '';
    reportEl.querySelector('.leverage-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    aiStatusEl.textContent = `✗ ${err.message}`;
    aiStatusEl.className = 'muted status-error';
  } finally {
    generateAiBtn.disabled = false;
  }
});

clearCacheBtn.addEventListener('click', () => {
  clearCachedSummary();
  lastSummary = null;
  clearReportUi();
});

// ── Whoop connect / sync / disconnect ────────────────────────────────────

function syncWhoopUi() {
  if (!isRelayConfigured()) {
    whoopSectionEl.hidden = true;
    return;
  }
  whoopSectionEl.hidden = false;
  const connected = isConnected();
  whoopDisconnectedBlock.hidden = connected;
  whoopConnectedBlock.hidden = !connected;
}

whoopConnectBtn.addEventListener('click', () => {
  startConnect();
});

whoopDisconnectBtn.addEventListener('click', () => {
  disconnectWhoop();
  syncWhoopUi();
});

async function syncWhoopData() {
  whoopErrorEl.textContent = '';
  clearReportUi();
  whoopSyncBtn.disabled = true;
  whoopSyncBtn.textContent = 'Syncing…';
  try {
    const { parsedFiles, warnings } = await fetchWhoopData();
    analyzeParsedFiles(parsedFiles);
    if (warnings.length) {
      whoopErrorEl.textContent = warnings.join(' ');
    }
    reportEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    whoopErrorEl.textContent = err.message;
  } finally {
    whoopSyncBtn.disabled = false;
    whoopSyncBtn.textContent = 'Sync Whoop Data';
  }
}

whoopSyncBtn.addEventListener('click', syncWhoopData);

syncWhoopUi();

// Just back from Whoop's consent screen via oauth-callback.html — clean the
// URL and sync immediately rather than making the user click twice (and
// skip restoring the cached report below, so it doesn't flash briefly
// before the fresh sync replaces it).
const justConnected = new URLSearchParams(window.location.search).get('whoop') === 'connected';
if (justConnected) {
  window.history.replaceState({}, '', window.location.pathname);
  syncWhoopUi();
  syncWhoopData();
} else {
  // Restore the last computed report, if any, so a reload doesn't lose it.
  const cached = loadCachedSummary();
  if (cached) {
    renderSummary(cached);
    restoredBannerEl.hidden = false;
  }
}
