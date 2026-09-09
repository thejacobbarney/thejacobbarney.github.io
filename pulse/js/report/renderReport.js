import { escapeHtml, formatDate } from '../utils.js';

function fmt(value, unit = '') {
  if (value === null || value === undefined) return '—';
  return `${value}${unit ? ' ' + unit : ''}`;
}

function section(title, innerHtml) {
  return `<section class="report-section"><h2>${escapeHtml(title)}</h2>${innerHtml}</section>`;
}

function renderDataSummary(inventory) {
  const filesHtml = inventory.files
    .map((f) => `<li><strong>${escapeHtml(f.name)}</strong> — ${escapeHtml(f.format)}, ${f.rowCount} row(s)</li>`)
    .join('');

  const categoriesHtml = inventory.categoriesPresent
    .map((c) => `<li><strong>${escapeHtml(c.category)}:</strong> ${c.fields.map(escapeHtml).join(', ')}</li>`)
    .join('');

  const qualityNotes = [];
  if (inventory.fewerThan14Days) {
    qualityNotes.push(`Only ${inventory.daysWithData} day(s) of data — patterns below are suggestive, not statistically reliable.`);
  }
  if (inventory.gaps.length) {
    qualityNotes.push(
      `${inventory.gaps.length} gap(s) longer than 2 days: ` +
        inventory.gaps.map((g) => `${formatDate(g.start)}–${formatDate(g.end)} (${g.days}d)`).join(', ')
    );
  }
  if (inventory.sparseFields.length) {
    qualityNotes.push(
      `Sparse coverage (under 50% of days) for: ` + inventory.sparseFields.map((f) => `${f.label} (${f.pct}%)`).join(', ')
    );
  }
  if (inventory.deviceNote) qualityNotes.push(inventory.deviceNote);

  return section(
    'Data Summary',
    `
    <ul class="plain-list">${filesHtml}</ul>
    <p><strong>Date range:</strong> ${inventory.startDate ? formatDate(inventory.startDate) : '—'} to ${inventory.endDate ? formatDate(inventory.endDate) : '—'}
      (${inventory.daysWithData} of ${inventory.totalDaysInRange} day(s) have data)</p>
    <p><strong>Data types found:</strong></p>
    <ul class="plain-list">${categoriesHtml || '<li>None recognized.</li>'}</ul>
    ${qualityNotes.length ? `<div class="quality-notes"><strong>Data quality notes</strong><ul class="plain-list">${qualityNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>` : ''}
  `
  );
}

function renderBaselineTable(baselines) {
  const rows = Object.values(baselines.averages)
    .map((m) => `<tr><td>${escapeHtml(m.label)}</td><td>${fmt(m.avg, m.unit)}</td><td class="muted">${m.n} day(s)</td></tr>`)
    .join('');

  const extras = [];
  if (baselines.bedtimeAvg) extras.push(`<tr><td>Average bedtime</td><td>${escapeHtml(baselines.bedtimeAvg)}</td><td></td></tr>`);
  if (baselines.waketimeAvg) extras.push(`<tr><td>Average wake time</td><td>${escapeHtml(baselines.waketimeAvg)}</td><td></td></tr>`);

  let weekdayTable = '';
  if (baselines.rhrByWeekday?.length) {
    weekdayTable = `<h3>RHR by day of week</h3><table class="report-table"><thead><tr>${baselines.rhrByWeekday
      .map((d) => `<th>${d.day}</th>`)
      .join('')}</tr></thead><tbody><tr>${baselines.rhrByWeekday.map((d) => `<td>${fmt(d.avg, 'bpm')}</td>`).join('')}</tr></tbody></table>`;
  }

  let archTable = '';
  if (baselines.sleepArchitecturePct) {
    const a = baselines.sleepArchitecturePct;
    archTable = `<h3>Sleep architecture</h3><table class="report-table"><thead><tr><th>Deep</th><th>REM</th><th>Light</th></tr></thead><tbody><tr><td>${fmt(a.deepPct, '%')}</td><td>${fmt(a.remPct, '%')}</td><td>${fmt(a.lightPct, '%')}</td></tr></tbody></table>`;
  }

  return section(
    'Baseline Profile',
    `<table class="report-table"><thead><tr><th>Metric</th><th>Average</th><th></th></tr></thead><tbody>${rows}${extras.join('')}</tbody></table>${weekdayTable}${archTable}`
  );
}

function trendText(t) {
  if (!t) return '';
  return `${t.direction} (${t.perWeek > 0 ? '+' : ''}${t.perWeek} ${t.unit})`;
}

function renderPatternAnalysis(patterns) {
  const blocks = [];

  if (patterns.sleep) {
    const s = patterns.sleep;
    const items = [];
    if (s.bedtimeVarianceMin !== undefined) items.push(`Bedtime consistency: ±${s.bedtimeVarianceMin} min night-to-night${s.bedtimeHighVariance ? ' — high variance, a major sleep-quality driver' : ''}.`);
    if (s.waketimeVarianceMin !== undefined) items.push(`Wake time consistency: ±${s.waketimeVarianceMin} min night-to-night${s.waketimeHighVariance ? ' — high variance' : ''}.`);
    if (s.durationTrend) items.push(`Sleep duration trend: ${trendText(s.durationTrend)}.`);
    if (s.architecture) {
      const flags = s.architectureFlags?.length ? ` Outside typical range: ${s.architectureFlags.map((f) => `${f.field} ${f.value}% (norm ${f.norm[0]}-${f.norm[1]}%)`).join(', ')}.` : '';
      items.push(`Sleep architecture — Deep ${fmt(s.architecture.deepPct, '%')}, REM ${fmt(s.architecture.remPct, '%')}, Light ${fmt(s.architecture.lightPct, '%')}.${flags}`);
    }
    if (s.lowEfficiency !== undefined) items.push(`Sleep efficiency is ${s.lowEfficiency ? 'below the 85% flag threshold' : 'at or above the 85% healthy threshold'}.`);
    if (s.highLatency !== undefined) items.push(`Sleep latency is ${s.highLatency ? 'above the 20-minute flag threshold' : 'within a normal range'}.`);
    if (s.respiratoryTrend) items.push(`Respiratory rate trend: ${trendText(s.respiratoryTrend)}.`);
    if (s.spo2) items.push(`SpO2 — avg ${fmt(s.spo2.avg, '%')}, min ${fmt(s.spo2.min, '%')}, ${s.spo2.daysBelow94} day(s) below 94%.`);
    blocks.push(`<h3>Sleep</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (patterns.hrv) {
    const h = patterns.hrv;
    const items = [];
    if (h.trend) items.push(`Overall trend: ${trendText(h.trend)}.`);
    if (h.dayToDayVariability !== null && h.dayToDayVariability !== undefined) items.push(`Night-to-night variability (stddev of day-over-day change): ${h.dayToDayVariability} ms.`);
    if (h.changePct !== undefined) items.push(`First 7 days avg ${h.first7DayAvg} ms vs last 7 days avg ${h.last7DayAvg} ms (${h.changePct > 0 ? '+' : ''}${h.changePct}%).`);
    if (h.rolling28DayAvg !== undefined) items.push(`28-day rolling average: ${h.rolling28DayAvg} ms — most recent reading ${h.latest} ms (${h.latestVsRolling > 0 ? '+' : ''}${h.latestVsRolling} vs. average).`);
    if (h.bedtimeCorrelation !== undefined) items.push(`Correlation with bedtime: r = ${h.bedtimeCorrelation}.`);
    if (h.priorStrainCorrelation !== undefined) items.push(`Correlation with prior-day ${h.priorStrainField}: r = ${h.priorStrainCorrelation}.`);
    if (h.recoveryCorrelation !== undefined) items.push(`Correlation with recovery score: r = ${h.recoveryCorrelation}.`);
    blocks.push(`<h3>Heart Rate Variability</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (patterns.rhr) {
    const r = patterns.rhr;
    const items = [`Baseline: ${r.baseline} bpm. Trend: ${trendText(r.trend)}.`];
    items.push(`Elevation events (over baseline + 5 bpm): ${r.elevationCount} day(s)${r.elevationEvents.length ? ' — most recent: ' + r.elevationEvents.map((e) => `${formatDate(e.date)} (${e.value} bpm, +${e.delta})`).join(', ') : ''}.`);
    blocks.push(`<h3>Resting Heart Rate</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (patterns.temp) {
    const t = patterns.temp;
    const items = [`Stability (stddev): ±${t.stddev}°.`];
    items.push(`Nights above +0.5°: ${t.elevationEvents.length}${t.elevationEvents.length ? ' — ' + t.elevationEvents.map((e) => `${formatDate(e.date)} (+${e.value}°)`).join(', ') : ''}.`);
    if (t.consecutiveElevationRuns.length) {
      items.push(`Sustained elevation runs: ${t.consecutiveElevationRuns.map((r) => `${formatDate(r.start)}–${formatDate(r.end)} (${r.nights} nights)`).join(', ')}.`);
    }
    blocks.push(`<h3>Body Temperature</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
  }

  if (patterns.strainRecovery) {
    const sr = patterns.strainRecovery;
    const items = [];
    if (sr.weeklyChangePct !== undefined && sr.weeklyChangePct !== null) items.push(`Weekly ${sr.weeklyLoadField} is trending ${sr.weeklyChangePct > 0 ? '+' : ''}${sr.weeklyChangePct}% per week.`);
    if (sr.recoveryMismatchDays) items.push(`Trained hard on a low-recovery day: ${sr.recoveryMismatchDays.length} day(s)${sr.recoveryMismatchDays.length ? ' — e.g. ' + sr.recoveryMismatchDays.slice(0, 5).map((d) => formatDate(d.date)).join(', ') : ''}.`);
    if (items.length) blocks.push(`<h3>Strain vs. Recovery Balance</h3><ul class="plain-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
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
  } else {
    blocks.push(`<h3>Behavioral Correlations</h3><p class="muted">No journal/tag data (alcohol, caffeine, travel, late meals) found in the upload — this section would show how those specifically affect your HRV, RHR, and sleep if logged.</p>`);
  }

  return section('Pattern Analysis', blocks.join(''));
}

function renderLeveragePoints(leveragePoints) {
  const cards = leveragePoints
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
  return section('Top 5 Leverage Points', cards);
}

function renderProtocol(protocol) {
  const list = (items) => `<ul class="plain-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return section(
    'Your Protocol This Week',
    `
    <h3>Non-Negotiables</h3>${list(protocol.nonNegotiables)}
    <h3>Quick Wins</h3>${list(protocol.quickWins)}
    <h3>Watch Closely</h3>${list(protocol.watchClosely)}
    ${protocol.flags?.length ? `<h3 class="flag-heading">Flags for Medical Attention</h3>${list(protocol.flags)}` : ''}
  `
  );
}

function renderAiPlaceholder() {
  return section(
    'Top 5 Leverage Points & Weekly Protocol',
    `<p class="muted">These two sections require judgment and prioritization, not just arithmetic — turn on AI assistance above (bring your own Anthropic API key) to generate them from the computed data above. Everything above this point was computed entirely offline in your browser.</p>`
  );
}

/** @returns {string} full report HTML, appended into a container by app.js */
export function renderReport({ inventory, baselines, patterns, aiReport }) {
  const parts = [renderDataSummary(inventory), renderBaselineTable(baselines), renderPatternAnalysis(patterns)];
  if (aiReport) {
    parts.push(renderLeveragePoints(aiReport.leveragePoints));
    parts.push(renderProtocol(aiReport.protocol));
  } else {
    parts.push(renderAiPlaceholder());
  }
  return parts.join('');
}
