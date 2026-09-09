import { parseFile, mergeParsedFiles } from './parsers/fileParser.js';
import { buildInventory } from './analysis/inventory.js';
import { buildBaselines } from './analysis/baselines.js';
import { buildPatterns } from './analysis/patterns.js';
import { renderReport } from './report/renderReport.js';
import { renderAiSettingsPanel } from './components/aiSettingsPanel.js';
import { loadAiConfig } from './aiConfig.js';
import { generateAiReport } from './report/aiReport.js';
import { escapeHtml } from './utils.js';

const fileInput = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const analyzeBtn = document.getElementById('analyze-btn');
const errorEl = document.getElementById('upload-error');
const aiPanelEl = document.getElementById('ai-settings-panel-container');
const reportEl = document.getElementById('report-root');
const generateAiBtn = document.getElementById('generate-ai-btn');
const aiStatusEl = document.getElementById('generate-ai-status');

let selectedFiles = [];
let lastSummary = null;
let aiConfig = renderAiSettingsPanel(aiPanelEl, { onChange: (cfg) => syncAiButton(cfg) });

function syncAiButton(cfg) {
  aiConfig = cfg;
  generateAiBtn.hidden = !(lastSummary && cfg.enabled && cfg.apiKey);
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
  reportEl.innerHTML = '';
  generateAiBtn.hidden = true;
  aiStatusEl.textContent = '';
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

    const records = mergeParsedFiles(parsedFiles);
    const inventory = buildInventory(parsedFiles, records);
    const baselines = buildBaselines(records);
    if (baselines.averages.hrv && inventory.hrvMetric && inventory.hrvMetric !== 'unspecified') {
      baselines.averages.hrv.label += ` (${inventory.hrvMetric})`;
    }
    const patterns = buildPatterns(records, baselines);

    lastSummary = { inventory, baselines, patterns };
    reportEl.innerHTML = renderReport(lastSummary);
    if (parseErrors.length) {
      errorEl.textContent = `Some files were skipped: ${parseErrors.join(' ')}`;
    }
    syncAiButton(aiConfig);
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
    reportEl.innerHTML = renderReport({ ...lastSummary, aiReport });
    aiStatusEl.textContent = '';
    document.getElementById('report-root').querySelector('.leverage-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    aiStatusEl.textContent = `✗ ${err.message}`;
    aiStatusEl.className = 'muted status-error';
  } finally {
    generateAiBtn.disabled = false;
  }
});
