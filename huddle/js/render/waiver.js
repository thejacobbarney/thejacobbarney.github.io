import { escapeHtml, fmtPts } from '../utils.js';
import { findWaiverUpgrades, playerValue } from '../lineup.js';
import { loadAiConfig } from '../aiConfig.js';
import { generateClaudeWaiverCheck } from '../report/aiWaiver.js';
import { generateSynthesis } from '../report/aiSynthesis.js';
import { loadGrokConfig, grokReady } from '../grokConfig.js';
import { runGrok } from '../report/research/grok.js';
import { loadPerplexityConfig, perplexityReady } from '../perplexityConfig.js';
import { runPerplexity } from '../report/research/perplexity.js';
import { renderAiViews } from '../components/aiViews.js';
import { renderWaiverCard } from '../components/researchCards.js';

// Claude's check, kept per league fetch so a fresh fetch drops a stale one (same pattern as myTeam.js).
const claudeCache = new WeakMap();

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
  const claudeOn = () => {
    const c = loadAiConfig();
    return Boolean(c.enabled && c.apiKey);
  };
  const cached = claudeCache.get(league) || null;
  const summaryNow = () => buildWaiverSummary(league, suggestions, byPos);

  root.innerHTML = `
    ${suggestionsHtml(suggestions)}
    ${
      claudeOn()
        ? `<div class="ai-generate-row">
            <button type="button" id="waiver-claude-btn" class="btn">Check with Claude</button>
            <span id="waiver-claude-status" class="muted small"></span>
          </div>`
        : '<p class="muted small">Enable AI assistance on the My Team tab to have Claude check these moves.</p>'
    }
    <div id="waiver-claude-result">${cached ? renderWaiverCard('Claude waiver check', cached) : ''}</div>
    <div id="waiver-ai-views"></div>
    <h2>Top available</h2>
    ${positions.map((pos) => poolTable(pos, byPos.get(pos))).join('')}
  `;

  const viewsApi = renderAiViews(root.querySelector('#waiver-ai-views'), {
    scope: league,
    key: 'waiver',
    decision: 'waiver-wire add/drop moves',
    getClaude: () => claudeCache.get(league)?.data || null,
    claudeReady: claudeOn,
    getBrief: () => ({
      week: league.week,
      suggestedMoves: suggestions.map((s) => ({ add: s.add.name, drop: s.drop.name, projectedGain: s.delta })),
    }),
    providers: [
      {
        id: 'grok',
        label: 'Grok',
        ready: () => grokReady(loadGrokConfig()),
        run: () => runGrok('waiver', summaryNow(), loadGrokConfig()),
        render: (res) => renderWaiverCard('Grok waiver check', res),
      },
      {
        id: 'perplexity',
        label: 'Perplexity',
        ready: () => perplexityReady(loadPerplexityConfig()),
        run: () => runPerplexity('waiver', summaryNow(), loadPerplexityConfig()),
        render: (res) => renderWaiverCard('Perplexity waiver check', res),
      },
    ],
    synthesize: (brief, views) => generateSynthesis('waiver-wire add/drop moves', brief, views, loadAiConfig()),
  });

  const btn = root.querySelector('#waiver-claude-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      const statusEl = root.querySelector('#waiver-claude-status');
      const resultEl = root.querySelector('#waiver-claude-result');
      btn.disabled = true;
      statusEl.textContent = 'Thinking…';
      statusEl.className = 'muted small';
      try {
        const result = await generateClaudeWaiverCheck(summaryNow(), loadAiConfig());
        claudeCache.set(league, result);
        resultEl.innerHTML = renderWaiverCard('Claude waiver check', result);
        viewsApi.refresh();
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
