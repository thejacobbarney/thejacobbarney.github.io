import { escapeHtml, fmtPts } from '../utils.js';
import { findStartSitSuggestions } from '../lineup.js';
import { BENCH_SLOT_ID, IR_SLOT_ID } from '../constants.js';

const SLOT_ORDER = [0, 2, 3, 4, 5, 6, 23, 7, 16, 17, 18, 8, 9, 10, 11, 12, 13, 14, 15, 19];

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

function playerRow(p) {
  return `
    <tr>
      <td class="col-slot">${escapeHtml(p.slotLabel)}</td>
      <td class="col-player">
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="muted player-meta">${escapeHtml(p.proTeam)} · ${escapeHtml(p.defaultPosition)}</span>
        ${injuryBadge(p.injuryStatus)}
      </td>
      <td class="num col-num">${fmtPts(p.projected)}</td>
      <td class="num col-num">${fmtPts(p.actual)}</td>
    </tr>`;
}

function table(title, players) {
  if (players.length === 0) return '';
  return `
    <div class="roster-group">
      <h3>${escapeHtml(title)}</h3>
      <table class="roster-table">
        <thead><tr><th>Slot</th><th>Player</th><th class="num">Proj</th><th class="num">Actual</th></tr></thead>
        <tbody>${players.slice().sort(slotSort).map(playerRow).join('')}</tbody>
      </table>
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

  root.innerHTML = `
    <div class="team-header">
      <h2>${escapeHtml(league.myTeam.name)}</h2>
      ${league.week ? `<span class="muted">Week ${league.week}</span>` : ''}
    </div>
    ${suggestionsHtml}
    ${table('Starters', starters)}
    ${table('Bench', bench)}
    ${table('IR', ir)}
  `;
}
