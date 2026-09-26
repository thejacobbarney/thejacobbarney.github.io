import { escapeHtml, fmtPts } from '../utils.js';
import { findStartSitSuggestions, findWaiverUpgrades } from '../lineup.js';
import { BENCH_SLOT_ID, IR_SLOT_ID } from '../constants.js';
import { loadAiConfig } from '../aiConfig.js';
import { renderAiSettingsPanel } from '../components/aiSettingsPanel.js';
import { generateAiRecommendation } from '../report/aiRecommendation.js';

const SLOT_ORDER = [0, 2, 3, 4, 5, 6, 23, 7, 16, 17, 18, 8, 9, 10, 11, 12, 13, 14, 15, 19];

// Keyed by the league object itself, so a generated game plan survives
// switching tabs away and back (renderMyTeam gets called again with the
// same object), but a fresh fetch (a new object from app.js) starts clean.
const aiResultCache = new WeakMap();

function slotSort(a, b) {
  const ia = SLOT_ORDER.indexOf(a.slotId);
  const ib = SLOT_ORDER.indexOf(b.slotId);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}

function injuryBadge(status) {
  if (!status || status === 'ACTIVE') return '';
  const cls = status === 'OUT' || status === 'INJURY_RESERVE' ? 'badge-out' : 'badge-warn';
  return `<span class="badge ${cls}">${escapeHtml(status.replace('_', ' '))}</span>`;
}

function byeBadge(byeWeek, week) {
  if (typeof byeWeek !== 'number' || byeWeek !== week) return '';
  return `<span class="badge badge-out">BYE</span>`;
}

function trendText(recentActual) {
  if (!recentActual || recentActual.length === 0) return '';
  const pts = recentActual.map((r) => fmtPts(r.points)).join(', ');
  return `<span class="muted player-meta">last ${recentActual.length}: ${pts}</span>`;
}

function playerRow(p, week) {
  return `
    <tr>
      <td class="col-slot">${escapeHtml(p.slotLabel)}</td>
      <td class="col-player">
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="muted player-meta">${escapeHtml(p.proTeam)} · ${escapeHtml(p.defaultPosition)}</span>
        ${trendText(p.recentActual)}
        ${injuryBadge(p.injuryStatus)}
        ${byeBadge(p.byeWeek, week)}
      </td>
      <td class="num col-num">${fmtPts(p.projected)}</td>
      <td class="num col-num">${fmtPts(p.actual)}</td>
    </tr>`;
}

function table(title, players, week) {
  if (players.length === 0) return '';
  return `
    <div class="roster-group">
      <h3>${escapeHtml(title)}</h3>
      <table class="roster-table">
        <thead><tr><th>Slot</th><th>Player</th><th class="num">Proj</th><th class="num">Actual</th></tr></thead>
        <tbody>${players
          .slice()
          .sort(slotSort)
          .map((p) => playerRow(p, week))
          .join('')}</tbody>
      </table>
    </div>`;
}

/** A compact player shape for the AI request — no need to send every field it doesn't use. */
function compactPlayer(p) {
  return {
    name: p.name,
    slot: p.slotLabel,
    position: p.defaultPosition,
    proTeam: p.proTeam,
    projected: p.projected,
    recentActual: p.recentActual,
    injuryStatus: p.injuryStatus,
    byeWeek: p.byeWeek,
  };
}

function buildAiSummary(league, startSitSuggestions) {
  const roster = league.myTeam.roster;
  return {
    week: league.week,
    matchup: league.matchup
      ? {
          opponent: league.matchup.opponent?.name ?? null,
          myProjectedTotal: roster
            .filter((p) => p.slotId !== BENCH_SLOT_ID && p.slotId !== IR_SLOT_ID)
            .reduce((sum, p) => sum + (typeof p.projected === 'number' ? p.projected : 0), 0),
        }
      : null,
    starters: roster
      .filter((p) => p.slotId !== BENCH_SLOT_ID && p.slotId !== IR_SLOT_ID)
      .map(compactPlayer),
    bench: roster.filter((p) => p.slotId === BENCH_SLOT_ID).map(compactPlayer),
    precomputedStartSitSuggestions: startSitSuggestions.map((s) => ({
      upgrade: s.upgrade.name,
      overStarter: s.starter.name,
      slot: s.starter.slotLabel,
      projectedDelta: s.delta,
    })),
    precomputedWaiverSuggestions: league.freeAgents
      ? findWaiverUpgrades(roster, league.freeAgents).map((s) => ({
          add: s.add.name,
          position: s.add.defaultPosition,
          drop: s.drop.name,
          projectedDelta: s.delta,
        }))
      : [],
    upcomingSchedule: league.upcomingMatchups || [],
  };
}

function moveList(title, items, renderItem) {
  if (!items || items.length === 0) return '';
  return `<div class="ai-move-group"><h4>${escapeHtml(title)}</h4><ul class="plain-list">${items
    .map((i) => `<li>${renderItem(i)}</li>`)
    .join('')}</ul></div>`;
}

function renderAiResult(rec) {
  return `
    <div class="card ai-result">
      <p class="ai-headline">${escapeHtml(rec.headline)}</p>
      ${moveList(
        'Lineup',
        rec.lineupMoves,
        (m) => `<b>${escapeHtml(m.action.toUpperCase())}</b> ${escapeHtml(m.player)} — ${escapeHtml(m.reasoning)}`
      )}
      ${moveList(
        'Waiver wire',
        rec.waiverMoves,
        (m) => `Add <b>${escapeHtml(m.add)}</b>, drop <b>${escapeHtml(m.drop)}</b> — ${escapeHtml(m.reasoning)}`
      )}
      ${moveList('Watch before lineups lock', rec.watchList, (w) => escapeHtml(w))}
    </div>`;
}

export function renderMyTeam(root, league) {
  if (!league.myTeam) {
    root.innerHTML = `<div class="card"><p>Couldn't find your team in this league's response. Double check the Team ID in Settings.</p></div>`;
    return;
  }

  const roster = league.myTeam.roster;
  const starters = roster.filter((p) => p.slotId !== BENCH_SLOT_ID && p.slotId !== IR_SLOT_ID);
  const bench = roster.filter((p) => p.slotId === BENCH_SLOT_ID);
  const ir = roster.filter((p) => p.slotId === IR_SLOT_ID);
  const suggestions = findStartSitSuggestions(roster);

  const suggestionsHtml = suggestions.length
    ? `
      <div class="card callout">
        <h3>Start/Sit — ${suggestions.length} possible upgrade${suggestions.length > 1 ? 's' : ''}</h3>
        <ul class="plain-list">
          ${suggestions
            .map(
              (s) => `<li><b>${escapeHtml(s.upgrade.name)}</b> (${escapeHtml(s.upgrade.proTeam)}) projects
                <span class="num">+${fmtPts(s.delta)}</span> over
                <b>${escapeHtml(s.starter.name)}</b> at ${escapeHtml(s.starter.slotLabel)}</li>`
            )
            .join('')}
        </ul>
        <p class="muted small">Based on projected points only — doesn't know about weather, news since the projection ran, or your gut.</p>
      </div>`
    : `<div class="card callout callout-ok"><p>No projected upgrades on your bench right now — your lineup looks optimal by the numbers.</p></div>`;

  const cachedAiResult = aiResultCache.get(league) || null;

  root.innerHTML = `
    <div class="team-header">
      <h2>${escapeHtml(league.myTeam.name)}</h2>
      ${league.week ? `<span class="muted">Week ${league.week}</span>` : ''}
    </div>
    ${suggestionsHtml}
    <div id="ai-settings-container"></div>
    <div id="ai-generate-row" class="ai-generate-row" hidden>
      <button type="button" id="ai-generate-btn" class="btn">Generate AI Game Plan</button>
      <span id="ai-generate-status" class="muted small"></span>
    </div>
    <div id="ai-result-container">${cachedAiResult ? renderAiResult(cachedAiResult) : ''}</div>
    ${table('Starters', starters, league.week)}
    ${table('Bench', bench, league.week)}
    ${table('IR', ir, league.week)}
  `;

  const generateRow = root.querySelector('#ai-generate-row');
  const generateBtn = root.querySelector('#ai-generate-btn');
  const statusEl = root.querySelector('#ai-generate-status');
  const resultContainer = root.querySelector('#ai-result-container');

  function syncGenerateVisibility(cfg) {
    generateRow.hidden = !(cfg.enabled && cfg.apiKey);
  }

  const aiConfig = renderAiSettingsPanel(root.querySelector('#ai-settings-container'), {
    onChange: syncGenerateVisibility,
  });
  syncGenerateVisibility(aiConfig);

  generateBtn.addEventListener('click', async () => {
    const cfg = loadAiConfig();
    generateBtn.disabled = true;
    statusEl.textContent = 'Thinking…';
    statusEl.className = 'muted small';
    try {
      const summary = buildAiSummary(league, suggestions);
      const rec = await generateAiRecommendation(summary, cfg);
      aiResultCache.set(league, rec);
      resultContainer.innerHTML = renderAiResult(rec);
      statusEl.textContent = '';
      resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      statusEl.className = 'muted small status-error';
    } finally {
      generateBtn.disabled = false;
    }
  });
}
