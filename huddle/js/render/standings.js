import { escapeHtml, fmtPts } from '../utils.js';

export function renderStandings(root, league) {
  const teams = league.teams.slice().sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.pointsFor ?? 0) - (a.pointsFor ?? 0);
  });

  if (teams.length === 0) {
    root.innerHTML = `<div class="card"><p>No standings data in this response.</p></div>`;
    return;
  }

  root.innerHTML = `
    <div class="card">
      <table class="roster-table standings-table">
        <thead><tr><th>#</th><th>Team</th><th class="num">W-L-T</th><th class="num">PF</th><th class="num">PA</th></tr></thead>
        <tbody>
          ${teams
            .map(
              (t, i) => `
            <tr class="${t.id === league.myTeam?.id ? 'row-mine' : ''}">
              <td>${i + 1}</td>
              <td>${escapeHtml(t.name)}</td>
              <td class="num">${t.wins}-${t.losses}-${t.ties}</td>
              <td class="num">${fmtPts(t.pointsFor)}</td>
              <td class="num">${fmtPts(t.pointsAgainst)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}
