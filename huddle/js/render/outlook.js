import { escapeHtml } from '../utils.js';
import { IR_SLOT_ID } from '../constants.js';

function scheduleHtml(league) {
  if (!league.upcomingMatchups || league.upcomingMatchups.length === 0) {
    return `<div class="card"><p class="muted">No upcoming matchups found — could be the end of the regular season.</p></div>`;
  }
  return `
    <div class="card">
      <h3>Upcoming schedule</h3>
      <ul class="plain-list">
        ${league.upcomingMatchups
          .map((m) => `<li><span class="muted">Week ${m.week}</span> — vs <b>${escapeHtml(m.opponent)}</b></li>`)
          .join('')}
      </ul>
    </div>`;
}

function byeWeekHtml(league) {
  const week = league.week;
  const roster = league.myTeam?.roster || [];
  const upcoming = roster
    .filter((p) => p.slotId !== IR_SLOT_ID && typeof p.byeWeek === 'number' && week != null && p.byeWeek >= week)
    .sort((a, b) => a.byeWeek - b.byeWeek);

  if (upcoming.length === 0) {
    return `<div class="card callout callout-ok"><p>No bye weeks on your roster in the data available.</p></div>`;
  }

  return `
    <div class="card callout">
      <h3>Bye weeks ahead</h3>
      <ul class="plain-list">
        ${upcoming
          .map(
            (p) => `<li><b>${escapeHtml(p.name)}</b> (${escapeHtml(p.proTeam)}) —
              ${p.byeWeek === week ? '<span class="badge badge-out">BYE THIS WEEK</span>' : `bye in week ${p.byeWeek}`}
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

export function renderOutlook(root, league) {
  if (!league.myTeam) {
    root.innerHTML = `<div class="card"><p>Couldn't find your team in this league's response.</p></div>`;
    return;
  }
  root.innerHTML = `${byeWeekHtml(league)}${scheduleHtml(league)}`;
}
