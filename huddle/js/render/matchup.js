import { escapeHtml, fmtPts } from '../utils.js';

export function renderMatchup(root, league) {
  const m = league.matchup;
  if (!m) {
    root.innerHTML = `<div class="card"><p>No matchup found for the current week — could be a bye week, or the season hasn't started.</p></div>`;
    return;
  }

  const mine = m.myTeam.total ?? 0;
  const theirs = m.opponent?.total ?? 0;
  const winning = mine >= theirs;

  root.innerHTML = `
    <div class="card matchup-card">
      <p class="muted">Week ${m.week}</p>
      <div class="matchup-row">
        <div class="matchup-side ${winning ? 'matchup-lead' : ''}">
          <span class="matchup-name">${escapeHtml(m.myTeam.name)}</span>
          <span class="num matchup-score">${fmtPts(mine)}</span>
        </div>
        <span class="matchup-vs">vs</span>
        <div class="matchup-side ${!winning && m.opponent ? 'matchup-lead' : ''}">
          <span class="matchup-name">${m.opponent ? escapeHtml(m.opponent.name) : 'BYE'}</span>
          <span class="num matchup-score">${m.opponent ? fmtPts(theirs) : '—'}</span>
        </div>
      </div>
      ${m.opponent ? `<p class="muted small">Margin: <span class="num">${fmtPts(Math.abs(mine - theirs))}</span></p>` : ''}
    </div>
  `;
}
