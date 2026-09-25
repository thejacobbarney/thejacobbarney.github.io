import { escapeHtml, fmtPts } from '../utils.js';
import { findWaiverUpgrades } from '../lineup.js';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];

function posSort(a, b) {
  const ia = POSITION_ORDER.indexOf(a);
  const ib = POSITION_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}

function suggestionsHtml(suggestions) {
  if (suggestions.length === 0) {
    return `<div class="card callout callout-ok"><p>No free agent outprojects your weakest starter at their position right now.</p></div>`;
  }
  return `
    <div class="card callout">
      <h3>${suggestions.length} possible add/drop${suggestions.length > 1 ? 's' : ''}</h3>
      <ul class="plain-list">
        ${suggestions
          .map(
            (s) => `<li><b>Add ${escapeHtml(s.add.name)}</b> (${escapeHtml(s.add.proTeam)} ${escapeHtml(
              s.add.defaultPosition
            )}) <span class="num">+${fmtPts(s.delta)}</span> over dropping
              <b>${escapeHtml(s.drop.name)}</b></li>`
          )
          .join('')}
      </ul>
      <p class="muted small">Projected points only — check injury/news before you actually make the move.</p>
    </div>`;
}

function poolByPosition(freeAgents) {
  const byPos = new Map();
  for (const p of freeAgents) {
    if (typeof p.projected !== 'number') continue;
    const list = byPos.get(p.defaultPosition) || [];
    list.push(p);
    byPos.set(p.defaultPosition, list);
  }
  for (const list of byPos.values()) list.sort((a, b) => b.projected - a.projected);
  return byPos;
}

function poolTable(position, players) {
  return `
    <div class="roster-group">
      <h3>${escapeHtml(position)}</h3>
      <table class="roster-table">
        <thead><tr><th>Player</th><th class="num">Proj</th></tr></thead>
        <tbody>
          ${players
            .slice(0, 8)
            .map(
              (p) => `<tr>
                <td class="col-player">
                  <span class="player-name">${escapeHtml(p.name)}</span>
                  <span class="muted player-meta">${escapeHtml(p.proTeam)}</span>
                </td>
                <td class="num col-num">${fmtPts(p.projected)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

export function renderWaiver(root, league) {
  if (!league.myTeam) {
    root.innerHTML = `<div class="card"><p>Couldn't find your team in this league's response.</p></div>`;
    return;
  }
  if (!league.freeAgents) {
    root.innerHTML = `<div class="card"><p class="error-text">${escapeHtml(
      league.freeAgentsError || 'Free agent data failed to load.'
    )}</p></div>`;
    return;
  }

  const suggestions = findWaiverUpgrades(league.myTeam.roster, league.freeAgents);
  const byPos = poolByPosition(league.freeAgents);
  const positions = [...byPos.keys()].sort(posSort);

  root.innerHTML = `
    ${suggestionsHtml(suggestions)}
    <h2>Top available</h2>
    ${positions.map((pos) => poolTable(pos, byPos.get(pos))).join('')}
  `;
}
