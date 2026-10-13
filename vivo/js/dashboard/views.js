import { escapeHtml, formatDate } from '../utils.js';
import { METRICS } from '../analysis/metricCatalog.js';
import { renderVitalsBar, pickRingField } from '../report/renderVitals.js';
import { renderLineChart } from '../charts.js';
import { fmt, viewSection, scrollableTable, trendText, emptyState } from './helpers.js';

export const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', icon: 'overview' },
  { key: 'sleep', label: 'Sleep', icon: 'sleep' },
  { key: 'recovery', label: 'Recovery', icon: 'recovery' },
  { key: 'activity', label: 'Activity', icon: 'activity' },
  { key: 'trends', label: 'Trends', icon: 'trends' },
  { key: 'insights', label: 'Insights', icon: 'insights' },
  { key: 'leverage', label: 'Leverage Points', icon: 'leverage' },
];

/** Real {date, value} pairs for one field from the raw per-day records — never interpolated. */
function trendPoints(records, field) {
  return (records || []).filter((r) => r[field] !== undefined && r[field] !== null).map((r) => ({ date: r.date, value: r[field] }));
}

function chartCard(title, points, { unit = '', color = '#14b8a6', caption } = {}) {
  if (points.length < 2) return '';
  const svg = renderLineChart(points, { color });
  if (!svg) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `
    <div class="chart-card">
      <div class="chart-card-title">${escapeHtml(title)}</div>
      <div class="chart-card-caption">${caption ? escapeHtml(caption) : `${points.length} day(s) tracked${unit ? ', ' + escapeHtml(unit) : ''}`}</div>
      ${svg}
      <div class="trend-chart-axis"><span>${escapeHtml(formatDate(first.date))}</span><span>${escapeHtml(formatDate(last.date))}</span></div>
    </div>`;
}

function fieldsByCategory(baselines, category) {
  return Object.entries(baselines.averages).filter(([field]) => METRICS[field]?.category === category);
}

function metricTable(entries, extraRows = []) {
  if (entries.length === 0 && extraRows.length === 0) return '';
  const rows = entries.map(([, m]) => `<tr><td>${escapeHtml(m.label)}</td><td>${fmt(m.avg, m.unit)}</td><td class="muted">${m.n} day(s)</td></tr>`).join('');
  return scrollableTable(
    `<table class="report-table"><thead><tr><th>Metric</th><th>Average</th><th></th></tr></thead><tbody>${rows}${extraRows.join('')}</tbody></table>`
  );
}

// ── Overview ──────────────────────────────────────────────────

function renderDataSummaryBlock(inventory) {
  const filesHtml = inventory.files.map((f) => `<li><strong>${escapeHtml(f.name)}</strong> — ${escapeHtml(f.format)}, ${f.rowCount} row(s)</li>`).join('');
  const categoriesHtml = inventory.categoriesPresent.map((c) => `<li><strong>${escapeHtml(c.category)}:</strong> ${c.fields.map(escapeHtml).join(', ')}</li>`).join('');

  const qualityNotes = [];
  if (inventory.fewerThan14Days) {
    qualityNotes.push(`Only ${inventory.daysWithData} day(s) of data — patterns elsewhere in this dashboard are suggestive, not statistically reliable.`);
  }
  if (inventory.gaps.length) {
    qualityNotes.push(`${inventory.gaps.length} gap(s) longer than 2 days: ` + inventory.gaps.map((g) => `${formatDate(g.start)}–${formatDate(g.end)} (${g.days}d)`).join(', '));
  }
  if (inventory.sparseFields.length) {
    qualityNotes.push(`Sparse coverage (under 50% of days) for: ` + inventory.sparseFields.map((f) => `${f.label} (${f.pct}%)`).join(', '));
  }
  if (inventory.deviceNote) qualityNotes.push(inventory.deviceNote);

  return `
    <h3>About this data</h3>
    <ul class="plain-list">${filesHtml}</ul>
    <p><strong>Date range:</strong> ${inventory.startDate ? formatDate(inventory.startDate) : '—'} to ${inventory.endDate ? formatDate(inventory.endDate) : '—'}
      (${inventory.daysWithData} of ${inventory.totalDaysInRange} day(s) have data)</p>
    <p><strong>Data types found:</strong></p>
    <ul class="plain-list">${categoriesHtml || '<li>None recognized.</li>'}</ul>
    ${qualityNotes.length ? `<div class="quality-notes"><strong>Data quality notes</strong><ul class="plain-list">${qualityNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>` : ''}
  `;
}

export function renderOverview({ inventory, baselines, patterns, aiReport, records }) {
  const vitalsHtml = renderVitalsBar(baselines);
  const ring = pickRingField(baselines);
  const trendField = ring ? ring.field : ['hrv', 'rhr', 'sleepTotalMin'].find((f) => baselines.averages[f]);
  const trendLabel = trendField ? METRICS[trendField]?.label || trendField : null;
  const trend = trendField ? chartCard(`${trendLabel} trend`, trendPoints(records, trendField), { unit: METRICS[trendField]?.unit }) : '';

  let leverageHtml;
  if (aiReport?.leveragePoints?.length) {
    leverageHtml = `<ul class="leverage-preview-list">${aiReport.leveragePoints
      .slice(0, 5)
      .map((lp, i) => `<li><span class="leverage-preview-rank">${i + 1}</span><span>${escapeHtml(lp.name)}</span></li>`)
      .join('')}</ul>`;
  } else {
    leverageHtml = emptyState('Turn on AI assistance in the Leverage Points tab to generate ranked, data-grounded leverage points from everything computed here.');
  }

  return `
    ${vitalsHtml}
    ${trend ? `<section class="view-section">${trend}</section>` : ''}
    ${viewSection('Top Leverage Points', leverageHtml)}
    ${viewSection(null, renderDataSummaryBlock(inventory))}
  `;
}

// ── Sleep ─────────────────────────────────────────────────────

export function renderSleep({ baselines, patterns, records }) {
  const sleepEntries = fieldsByCategory(baselines, 'Sleep');
  const extras = [];
  if (baselines.bedtimeAvg) extras.push(`<tr><td>Average bedtime</td><td>${escapeHtml(baselines.bedtimeAvg)}</td><td></td></tr>`);
  if (baselines.waketimeAvg) extras.push(`<tr><td>Average wake time</td><td>${escapeHtml(baselines.waketimeAvg)}</td><td></td></tr>`);
  const table = metricTable(sleepEntries, extras);

  let archTable = '';
  if (baselines.sleepArchitecturePct) {
    const a = baselines.sleepArchitecturePct;
    archTable = `<h3>Sleep architecture</h3>${scrollableTable(
      `<table class="report-table report-table--compact"><thead><tr><th>Deep</th><th>REM</th><th>Light</th></tr></thead><tbody><tr><td>${fmt(a.deepPct, '%')}</td><td>${fmt(a.remPct, '%')}</td><td>${fmt(a.lightPct, '%')}</td></tr></tbody></table>`
    )}`;
  }

  let weekdayTable = '';
  if (baselines.rhrByWeekday?.length) {
    weekdayTable = `<h3>RHR by day of week</h3>${scrollableTable(
      `<table class="report-table report-table--compact"><thead><tr>${baselines.rhrByWeekday.map((d) => `<th>${d.day}</th>`).join('')}</tr></thead><tbody><tr>${baselines.rhrByWeekday.map((d) => `<td>${fmt(d.avg, 'bpm')}</td>`).join('')}</tr></tbody></table>`
    )}`;
  }

  const items = [];
  const s = patterns.sleep;
  if (s) {
    if (s.bedtimeVarianceMin !== undefined) items.push(`Bedtime consistency: ±${s.bedtimeVarianceMin} min night-to-night${s.bedtimeHighVariance ? ' — high variance, a major sleep-quality driver' : ''}.`);
    if (s.waketimeVarianceMin !== undefined) items.push(`Wake time consistency: ±${s.waketimeVarianceMin} min night-to-night${s.waketimeHighVariance ? ' — high variance' : ''}.`);
    if (s.durationTrend) items.push(`Sleep duration trend: ${trendText(s.durationTrend)}.`);
    if (s.lowEfficiency !== undefined) items.push(`Sleep efficiency is ${s.lowEfficiency ? 'below the 85% flag threshold' : 'at or above the 85% healthy threshold'}.`);
    if (s.highLatency !== undefined) items.push(`Sleep latency is ${s.highLatency ? 'above the 20-minute flag threshold' : 'within a normal range'}.`);
    if (s.respiratoryTrend) items.push(`Respiratory rate trend: ${trendText(s.respiratoryTrend)}.`);
    if (s.spo2) items.push(`SpO2 — avg ${fmt(s.spo2.avg, '%')}, min ${fmt(s.spo2.min, '%')}, ${s.spo2.daysBelow94} day(s) below 94%.`);
    if (s.architectureFlags?.length) items.push(`Architecture outside typical range: ${s.architectureFlags.map((f) => `${f.field} ${f.value}% (norm ${f.norm[0]}-${f.norm[1]}%)`).join(', ')}.`);
  }

  const trend = chartCard('Sleep duration', trendPoints(records, 'sleepTotalMin').map((p) => ({ date: p.date, value: p.value / 60 })), { unit: 'hr' });

  if (!table && !items.length && !trend) return viewSection('Sleep', emptyState('No sleep data found in this upload.'));

  return viewSection(
    'Sleep',
    `${table}${archTable}${weekdayTable}${trend}${items.length ? `<h3>Patterns</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}`
  );
}

// ── Recovery ──────────────────────────────────────────────────

export function renderRecovery({ baselines, patterns, records }) {
  const vitalsHtml = renderVitalsBar(baselines, [
    { field: 'hrv', label: 'HRV', unit: 'ms' },
    { field: 'rhr', label: 'Resting HR', unit: 'bpm' },
    { field: 'stressScore', label: 'Stress', unit: '' },
    { field: 'recoveryScore', label: 'Recovery', unit: '%' },
  ]);

  const hrvItems = [];
  const h = patterns.hrv;
  if (h) {
    if (h.trend) hrvItems.push(`Overall trend: ${trendText(h.trend)}.`);
    if (h.dayToDayVariability !== null && h.dayToDayVariability !== undefined) hrvItems.push(`Night-to-night variability: ${h.dayToDayVariability} ms.`);
    if (h.changePct !== undefined) hrvItems.push(`First 7 days avg ${h.first7DayAvg} ms vs last 7 days avg ${h.last7DayAvg} ms (${h.changePct > 0 ? '+' : ''}${h.changePct}%).`);
    if (h.rolling28DayAvg !== undefined) hrvItems.push(`28-day rolling average: ${h.rolling28DayAvg} ms — most recent reading ${h.latest} ms (${h.latestVsRolling > 0 ? '+' : ''}${h.latestVsRolling} vs. average).`);
    if (h.bedtimeCorrelation !== undefined) hrvItems.push(`Correlation with bedtime: r = ${h.bedtimeCorrelation}.`);
    if (h.priorStrainCorrelation !== undefined) hrvItems.push(`Correlation with prior-day ${h.priorStrainField}: r = ${h.priorStrainCorrelation}.`);
    if (h.recoveryCorrelation !== undefined) hrvItems.push(`Correlation with recovery score: r = ${h.recoveryCorrelation}.`);
  }

  const rhrItems = [];
  const r = patterns.rhr;
  if (r) {
    rhrItems.push(`Baseline: ${r.baseline} bpm. Trend: ${trendText(r.trend)}.`);
    rhrItems.push(`Elevation events (over baseline + 5 bpm): ${r.elevationCount} day(s)${r.elevationEvents.length ? ' — most recent: ' + r.elevationEvents.map((e) => `${formatDate(e.date)} (${e.value} bpm, +${e.delta})`).join(', ') : ''}.`);
  }

  const hrvChart = chartCard('HRV', trendPoints(records, 'hrv'), { unit: 'ms' });
  const rhrChart = chartCard('Resting heart rate', trendPoints(records, 'rhr'), { unit: 'bpm', color: '#0b8577' });

  const hasAnything = !!vitalsHtml || hrvItems.length || rhrItems.length || hrvChart || rhrChart;
  if (!hasAnything) return viewSection('Recovery', emptyState('No recovery/HRV/RHR data found in this upload.'));

  return `
    ${vitalsHtml}
    <section class="view-section">
      ${hrvChart}
      ${rhrChart}
      ${hrvItems.length ? `<h3>HRV</h3><ul class="plain-list">${hrvItems.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}
      ${rhrItems.length ? `<h3>Resting heart rate</h3><ul class="plain-list">${rhrItems.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}
    </section>
  `;
}

// ── Activity ──────────────────────────────────────────────────

export function renderActivity({ baselines, patterns, records }) {
  const activityEntries = fieldsByCategory(baselines, 'Activity');
  const table = metricTable(activityEntries);

  const items = [];
  const sr = patterns.strainRecovery;
  let weeklyTable = '';
  if (sr) {
    if (sr.weeklyChangePct !== undefined && sr.weeklyChangePct !== null) items.push(`Weekly ${sr.weeklyLoadField} is trending ${sr.weeklyChangePct > 0 ? '+' : ''}${sr.weeklyChangePct}% per week.`);
    if (sr.weeklyAverages?.length) {
      weeklyTable = `<h3>Weekly ${escapeHtml(sr.weeklyLoadField)} average</h3>${scrollableTable(
        `<table class="report-table report-table--compact"><thead><tr>${sr.weeklyAverages.map((w) => `<th>${escapeHtml(formatDate(w.week))}</th>`).join('')}</tr></thead><tbody><tr>${sr.weeklyAverages.map((w) => `<td>${fmt(w.avg)}</td>`).join('')}</tr></tbody></table>`
      )}`;
    }
    if (sr.recoveryMismatchDays?.length) {
      items.push(`Trained hard on a low-recovery day: ${sr.recoveryMismatchDays.length} day(s) — e.g. ${sr.recoveryMismatchDays.slice(0, 5).map((d) => formatDate(d.date)).join(', ')}.`);
    }
  }

  const loadField = baselines.averages.strain ? 'strain' : baselines.averages.trainingLoad ? 'trainingLoad' : null;
  const chart = loadField ? chartCard(METRICS[loadField].label, trendPoints(records, loadField), { color: '#0b8577' }) : '';

  if (!table && !items.length && !weeklyTable && !chart) return viewSection('Activity', emptyState('No activity data (steps, strain, training load, workouts) found in this upload.'));

  return viewSection('Activity', `${table}${chart}${weeklyTable}${items.length ? `<h3>Patterns</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}`);
}

// ── Trends ────────────────────────────────────────────────────

export function renderTrends({ baselines, records }) {
  const candidates = [
    { field: 'recoveryScore', color: '#14b8a6' },
    { field: 'hrv', color: '#0b8577' },
    { field: 'rhr', color: '#1e9e7e' },
    { field: 'sleepTotalMin', color: '#5ed1be', transform: (v) => v / 60, unit: 'hr' },
    { field: 'sleepEfficiencyPct', color: '#14b8a6' },
    { field: 'stressScore', color: '#0e6f64' },
  ];

  const charts = candidates
    .filter((c) => baselines.averages[c.field])
    .map((c) => {
      const label = METRICS[c.field].label;
      const unit = c.unit || METRICS[c.field].unit;
      const points = trendPoints(records, c.field).map((p) => ({ date: p.date, value: c.transform ? c.transform(p.value) : p.value }));
      return chartCard(label, points, { unit, color: c.color });
    })
    .filter(Boolean);

  if (charts.length === 0) return viewSection('Trends', emptyState('Not enough day-by-day data yet to chart a trend — upload a longer export to see this.'));

  return viewSection('Trends', charts.join(''));
}

// ── Insights ──────────────────────────────────────────────────

export function renderInsights({ patterns }) {
  const blocks = [];

  if (patterns.temp) {
    const t = patterns.temp;
    const items = [];
    if (t.source === 'computedFromOwnAverage') {
      items.push(`This device reports absolute skin temperature, not a deviation from baseline — "elevation" below is this person's own reading minus their own dataset average, not a device-provided normal.`);
    }
    items.push(`Stability (stddev): ±${t.stddev}°.`);
    items.push(`Nights above +0.5°: ${t.elevationEvents.length}${t.elevationEvents.length ? ' — ' + t.elevationEvents.map((e) => `${formatDate(e.date)} (+${e.value}°)`).join(', ') : ''}.`);
    if (t.consecutiveElevationRuns.length) {
      items.push(`Sustained elevation runs: ${t.consecutiveElevationRuns.map((r) => `${formatDate(r.start)}–${formatDate(r.end)} (${r.nights} nights)`).join(', ')}.`);
    }
    blocks.push(`<h3>Body Temperature</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (patterns.stress) {
    const st = patterns.stress;
    const items = [`Trend: ${trendText(st.trend)}.`];
    if (st.nextDayHrvCorrelation !== undefined) items.push(`Correlation with next-day HRV: r = ${st.nextDayHrvCorrelation}.`);
    blocks.push(`<h3>Stress &amp; Autonomic Nervous System</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (patterns.behavioral) {
    const b = patterns.behavioral;
    const items = [];
    if (b.alcoholVsHrv) items.push(`HRV the morning after a logged alcohol day: ${b.alcoholVsHrv.avgAfterTrue} ms vs ${b.alcoholVsHrv.avgAfterFalse ?? '—'} ms otherwise (n=${b.alcoholVsHrv.nTrue} vs ${b.alcoholVsHrv.nFalse}).`);
    if (b.alcoholVsRhr) items.push(`RHR the morning after a logged alcohol day: ${b.alcoholVsRhr.avgAfterTrue} bpm vs ${b.alcoholVsRhr.avgAfterFalse ?? '—'} bpm otherwise.`);
    if (b.lateMealVsRhr) items.push(`RHR the morning after a logged late meal: ${b.lateMealVsRhr.avgAfterTrue} bpm vs ${b.lateMealVsRhr.avgAfterFalse ?? '—'} bpm otherwise.`);
    if (b.caffeineVsSleepEfficiency) items.push(`Sleep efficiency on a logged caffeine day: ${b.caffeineVsSleepEfficiency.avgAfterTrue}% vs ${b.caffeineVsSleepEfficiency.avgAfterFalse ?? '—'}% otherwise.`);
    if (b.travelDays?.length) items.push(`Logged travel on ${b.travelDays.length} day(s): ${b.travelDays.slice(0, 8).map(formatDate).join(', ')}.`);
    if (items.length) blocks.push(`<h3>Behavioral Correlations</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (blocks.length === 0) {
    return viewSection('Insights', emptyState('No journal/tag data (alcohol, caffeine, travel, late meals) or temperature/stress readings found in this upload — this tab shows how those specifically affect your HRV, RHR, and sleep once logged.'));
  }

  return viewSection('Insights', blocks.join(''));
}

// ── Leverage Points ───────────────────────────────────────────

/** Returns the static shell HTML; app.js mounts the AI settings panel into #leverage-ai-panel-mount after insertion and wires the generate button. */
export function renderLeverage({ aiReport }) {
  const aiPanelShell = `<div id="leverage-ai-panel-mount"></div>`;

  if (!aiReport) {
    return `
      ${viewSection(null, `${aiPanelShell}
        <p class="muted">The Top 5 Leverage Points and Weekly Protocol require judgment and prioritization, not just arithmetic — turn on AI assistance above (bring your own Anthropic API key) to generate them from everything already computed in this dashboard.</p>
        <div class="ai-generate-row">
          <button type="button" id="generate-ai-btn" class="btn" hidden>Generate Leverage Points &amp; Protocol</button>
          <span id="generate-ai-status" class="muted"></span>
        </div>`)}
    `;
  }

  const cards = aiReport.leveragePoints
    .map(
      (lp, i) => `
    <div class="leverage-card">
      <h3>#${i + 1} ${escapeHtml(lp.name)}</h3>
      <p><strong>Data:</strong> ${escapeHtml(lp.data)}</p>
      <p><strong>Why it matters:</strong> ${escapeHtml(lp.why)}</p>
      <p><strong>Estimated impact:</strong> ${escapeHtml(lp.impact)}</p>
      <p><strong>Actions:</strong></p>
      <ul class="plain-list">${lp.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
    </div>`
    )
    .join('');

  const list = (items) => `<ul class="plain-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  const protocol = aiReport.protocol;

  return `
    ${viewSection(null, `${aiPanelShell}
      <div class="ai-generate-row">
        <button type="button" id="generate-ai-btn" class="btn" hidden>Regenerate Leverage Points &amp; Protocol</button>
        <span id="generate-ai-status" class="muted"></span>
      </div>`)}
    ${viewSection('Top 5 Leverage Points', cards)}
    ${viewSection(
      'Your Protocol This Week',
      `<h3>Non-Negotiables</h3>${list(protocol.nonNegotiables)}
       <h3>Quick Wins</h3>${list(protocol.quickWins)}
       <h3>Watch Closely</h3>${list(protocol.watchClosely)}
       ${protocol.flags?.length ? `<h3 class="flag-heading">Flags for Medical Attention</h3>${list(protocol.flags)}` : ''}`
    )}
  `;
}

export const VIEW_RENDERERS = {
  overview: renderOverview,
  sleep: renderSleep,
  recovery: renderRecovery,
  activity: renderActivity,
  trends: renderTrends,
  insights: renderInsights,
  leverage: renderLeverage,
};
