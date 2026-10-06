import { escapeHtml, fmtPts, sourceLinksHtml } from '../utils.js';
import { findWaiverUpgrades, playerValue } from '../lineup.js';
import { loadPerplexityConfig, perplexityReady } from '../perplexityConfig.js';
import { generatePerplexityWaiverCheck } from '../report/perplexityResearch.js';

// Keyed by league object so a fresh fetch drops a stale check; same pattern as myTeam.js.
const checkCache = new WeakMap();

const VERDICT_LABEL = { go: 'Go', wait: 'Wait', skip: 'Skip' };
const VERDICT_CLASS = { go: 'badge-good', wait: 'badge-warn', skip: 'badge-out' };

function compactPlayer(p) {
  return {
    name: p.name,
    position: p.defaultPosition,
    proTeam: p.proTeam,
    recentValue: playerValue(p),
    projected: p.projected,
    seasonLog: (p.seasonLog || []).map((r) => ({ week: r.week, points: r.points })),
    injuryStatus: p.injuryStatus,
    byeWeek: p.byeWeek,
  };
}

function buildWaiverSummary(league, suggestions, byPos) {
  const topAvailable = {};
  for (const [pos, list] of byPos) topAvailable[pos] = list.slice(0, 5).map(compactPlayer);
  return {
    week: league.week,
    roster: league.myTeam.roster.map(compactPlayer),
    suggestions: suggestions.map((s) => ({
      add: compactPlayer(s.add),
      drop: compactPlayer(s.drop),
      projectedGain: s.delta,
    })),
    topAvailable,
  };
}

function gradeClass(grade) {
  return grade ? `grade-${grade[0].toLowerCase()}` : '';
}

function renderCheck({ check, rawText, sources }) {
  const sourcesHtml = sourceLinksHtml(sources);
  if (!check) {
    return `<div class="card ai-result"><h3>Perplexity waiver check</h3><p class="muted small">The reply wasn't in the expected format, so here it is as written.</p><p style="white-space:pre-wrap">${escapeHtml(rawText)}</p>${sourcesHtml}</div>`;
  }
  const moves = check.moves
    .map(
      (m) => `
      <li>
        <b>Add ${escapeHtml(m.add)}, drop ${escapeHtml(m.drop)}</b>
        ${m.verdict ? `<span class="badge ${VERDICT_CLASS[m.verdict]}">${VERDICT_LABEL[m.verdict]}</span>` : ''}
        ${m.grade ? `<span class="grade-letter grade-inline ${gradeClass(m.grade)}">${escapeHtml(m.grade)}</span>` : ''}
        <br><span class="muted small"><b>Add:</b> ${escapeHtml(m.newsOnAdd)}</span>
        <br><span class="muted small"><b>Drop:</b> ${escapeHtml(m.newsOnDrop)}</span>
        <br><span class="small">${escapeHtml(m.reasoning)}</span>
      </li>`
    )
    .join('');
  const targets = check.betterTargets
    .map((t) => `<li><b>${escapeHtml(t.name)}</b>: <span class="muted small">${escapeHtml(t.why)}</span></li>`)
    .join('');
  const notes = check.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
  return `
    <div class="card ai-result">
      <h3>Perplexity waiver check</h3>
      <p class="ai-headline">${escapeHtml(check.headline)}</p>
      ${moves ? `<div class="ai-move-group"><h4>Suggested moves</h4><ul class="plain-list">${moves}</ul></div>` : ''}
      ${targets ? `<div class="ai-move-group"><h4>Other pickups to consider</h4><ul class="plain-list">${targets}</ul></div>` : ''}
      ${notes ? `<div class="ai-move-group"><h4>Notes</h4><ul class="plain-list">${notes}</ul></div>` : ''}
      ${sourcesHtml}
    </div>`;
}

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

  const pplxOn = perplexityReady(loadPerplexityConfig());
  const cached = checkCache.get(league) || null;

  root.innerHTML = `
    ${suggestionsHtml(suggestions)}
    ${
      pplxOn
        ? `<div class="ai-generate-row">
            <button type="button" id="waiver-pplx-btn" class="btn">Check with Perplexity</button>
            <span id="waiver-pplx-status" class="muted small"></span>
          </div>`
        : '<p class="muted small">Add a Perplexity key on the My Team tab to check these moves against live news.</p>'
    }
    <div id="waiver-pplx-result">${cached ? renderCheck(cached) : ''}</div>
    <h2>Top available</h2>
    ${positions.map((pos) => poolTable(pos, byPos.get(pos))).join('')}
  `;

  const btn = root.querySelector('#waiver-pplx-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      const statusEl = root.querySelector('#waiver-pplx-status');
      const resultEl = root.querySelector('#waiver-pplx-result');
      btn.disabled = true;
      statusEl.textContent = 'Searching the web…';
      statusEl.className = 'muted small';
      try {
        const result = await generatePerplexityWaiverCheck(
          buildWaiverSummary(league, suggestions, byPos),
          loadPerplexityConfig()
        );
        checkCache.set(league, result);
        resultEl.innerHTML = renderCheck(result);
        statusEl.textContent = '';
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.className = 'muted small status-error';
      } finally {
        btn.disabled = false;
      }
    });
  }
}
