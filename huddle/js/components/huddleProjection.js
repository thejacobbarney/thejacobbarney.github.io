/** Rendering for Huddle's own projection (projection.js): table cells, notes, and the comparison card. */

import { escapeHtml, fmtPts } from '../utils.js';
import { diverges, mainReason } from '../projection.js';

const arrow = (p) => (p.huddle.value > p.projected ? 'up' : 'down');

export function huddleCell(p) {
  const v = p.huddle?.value;
  if (typeof v !== 'number') return '—';
  if (!diverges(p)) return fmtPts(v);
  const dir = arrow(p);
  return `<span class="huddle-${dir}">${dir === 'up' ? '▲' : '▼'} ${fmtPts(v)}</span>`;
}

/** One-line "why Huddle disagrees" under a player, only when it does. */
export function huddleNote(p) {
  if (!diverges(p)) return '';
  return `<span class="muted player-meta huddle-note">ESPN ${fmtPts(p.projected)}, Huddle ${fmtPts(p.huddle.value)}: ${escapeHtml(mainReason(p))}</span>`;
}

/** Compact projection fields for the AI summaries. */
export function compactHuddle(p) {
  if (!p.huddle || p.huddle.value === null) return {};
  return {
    huddleProjection: p.huddle.value,
    huddleBasis: p.huddle.basis,
    huddleAdjustments: p.huddle.components
      .slice(1)
      .filter((c) => Math.abs(c.delta) > 0.05)
      .map((c) => `${c.label}: ${c.delta > 0 ? '+' : ''}${c.delta.toFixed(1)}`),
    opponent: p.opponent ?? null,
    home: p.home ?? null,
  };
}

function disagreementRow(p, mine) {
  const dir = arrow(p);
  return `<li><b>${escapeHtml(p.name)}</b> <span class="muted small">(${escapeHtml(p.proTeam)} ${escapeHtml(p.defaultPosition)}${mine ? '' : ', free agent'})</span>
    <span class="huddle-${dir}">${dir === 'up' ? '▲' : '▼'}</span>
    <span class="num">ESPN ${fmtPts(p.projected)} → Huddle ${fmtPts(p.huddle.value)}</span>
    <br><span class="muted small">${escapeHtml(mainReason(p))}</span></li>`;
}

function validationHtml(v) {
  if (!v) return '';
  const parts = [];
  const bt = v.backtest;
  if (bt) {
    const better = bt.huddle.mae < bt.espn.mae ? 'Huddle' : bt.huddle.mae > bt.espn.mae ? 'ESPN' : 'Neither';
    parts.push(
      `<p class="small"><b>Accuracy so far</b> (${bt.n} player-games): ESPN's projection missed by <span class="num">${bt.espn.mae}</span> points on average, Huddle's recent-form estimate by <span class="num">${bt.huddle.mae}</span>. ${better === 'Neither' ? 'A tie.' : `${better} was closer overall`}${better === 'Neither' ? '' : `, and Huddle was closer on ${bt.huddleCloser}% of games`}. ESPN ${bt.espn.bias >= 0 ? 'over' : 'under'}-projected by ${Math.abs(bt.espn.bias)} on average. Past injuries and matchups aren't recorded, so this tests the recent-form part only.</p>`
    );
  } else {
    parts.push('<p class="muted small">Accuracy check needs about four completed weeks of history; it will appear once that has loaded.</p>');
  }
  const opp = v.opportunity || {};
  const lines = ['RB', 'WR', 'TE']
    .filter((pos) => opp[pos])
    .map((pos) => {
      const o = opp[pos];
      const measured = o.empirical === null ? 'no events yet' : `measured ${Math.round(o.empirical * 100)}% from ${o.events} case${o.events === 1 ? '' : 's'}`;
      return `${pos}: assume teammates absorb <span class="num">${Math.round(o.share * 100)}%</span> of an absent player's production (${measured})`;
    });
  if (lines.length) {
    parts.push(`<p class="small"><b>Opportunity boost</b><br>${lines.join('<br>')}<br><span class="muted">Measured from weeks a productive player didn't play in this league's history, blended toward a default when there are few cases.</span></p>`);
  }
  return parts.join('');
}

/** Collapsible "Huddle vs ESPN" card: biggest disagreements plus how both have performed. */
export function huddleCard(league) {
  const mineIds = new Set((league.myTeam?.roster || []).map((p) => p.playerId));
  const mine = (league.myTeam?.roster || []).filter(diverges);
  const free = (league.freeAgents || [])
    .filter(diverges)
    .sort((a, b) => Math.abs(b.huddle.value - b.projected) - Math.abs(a.huddle.value - a.projected))
    .slice(0, 6);
  const rows = [...mine.sort((a, b) => Math.abs(b.huddle.value - b.projected) - Math.abs(a.huddle.value - a.projected)), ...free];
  const open = rows.length > 0;
  return `
    <details class="ai-views huddle-card" ${open ? 'open' : ''}>
      <summary>Huddle vs ESPN projections <span class="muted small">· ${rows.length ? `${rows.length} disagreement${rows.length > 1 ? 's' : ''}` : 'no big gaps'}</span></summary>
      <div class="ai-views-body">
        <p class="muted small">Huddle's own estimate, built independently from recent games, teammates who are out, how the opponent has defended the position, home or road, and injury status. It is shown next to ESPN's so the gaps can be checked, not trusted blindly.</p>
        ${rows.length ? `<ul class="plain-list">${rows.map((p) => disagreementRow(p, mineIds.has(p.playerId))).join('')}</ul>` : '<p class="small">Huddle and ESPN agree within a few points on everyone right now.</p>'}
        ${validationHtml(league.validation)}
      </div>
    </details>`;
}

/** Huddle-vs-ESPN gaps for the players a decision involves, for the final comparison's brief. */
export function divergenceBrief(players) {
  return players.filter(diverges).map((p) => ({
    player: p.name,
    espn: p.projected,
    huddle: p.huddle.value,
    why: mainReason(p),
  }));
}
