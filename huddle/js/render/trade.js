import { escapeHtml, fmtPts } from '../utils.js';
import { playerValue } from '../lineup.js';
import { evaluateTrade, findLeagueTradeSuggestions } from '../trade.js';
import { loadAiConfig } from '../aiConfig.js';
import { generateTradeAnalysis } from '../report/aiTrade.js';
import { loadGrokConfig, grokReady } from '../grokConfig.js';
import { generateGrokTradeOpinion } from '../report/grokTrade.js';

// Module-level so selections survive switching tabs away and back within the
// same league fetch; a fresh fetch doesn't reset this on purpose (still
// building the same offer across a refresh is the common case), but
// changing partner clears both sides since picks belong to specific rosters.
const state = { partnerId: null, give: new Set(), receive: new Set() };
let aiResult = null;
let aiResultKey = null;
let grokResult = null;
let grokResultKey = null;

const VERDICT_LABEL = {
  favors_you: 'Favors you',
  favors_them: 'Favors them',
  even: 'Roughly even',
};

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

function buildTradeAiSummary(league, partner, giving, receiving, claudeAnalysis) {
  return {
    ...(claudeAnalysis ? { claudeAnalysis } : {}),
    week: league.week,
    you: { team: league.myTeam.name, roster: league.myTeam.roster.map(compactPlayer) },
    them: { team: partner.name, roster: partner.roster.map(compactPlayer) },
    trade: {
      youGive: giving.map(compactPlayer),
      youReceive: receiving.map(compactPlayer),
    },
  };
}

function seasonLogHtml(log) {
  if (!log || log.length === 0) return '';
  const pts = log.map((r) => fmtPts(r.points)).join(', ');
  return `<span class="muted player-meta">season: ${pts}</span>`;
}

function playerRow(p, side) {
  const value = playerValue(p);
  const checked = state[side].has(p.playerId) ? 'checked' : '';
  const injury =
    p.injuryStatus && p.injuryStatus !== 'ACTIVE'
      ? `<span class="badge ${p.injuryStatus === 'OUT' ? 'badge-out' : 'badge-warn'}">${escapeHtml(p.injuryStatus.replace('_', ' '))}</span>`
      : '';
  return `
    <label class="trade-row">
      <input type="checkbox" class="trade-check" data-side="${side}" data-id="${p.playerId}" ${checked} />
      <span class="trade-row-body">
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="muted player-meta">${escapeHtml(p.proTeam)} · ${escapeHtml(p.defaultPosition)} · <span class="num">${fmtPts(value)}</span> avg</span>
        ${seasonLogHtml(p.seasonLog)}
        ${injury}
      </span>
    </label>`;
}

function suggestionsHtml(suggestions) {
  if (suggestions.length === 0) {
    return `<div class="card"><p class="muted small">No mutually-beneficial trades found across the league right now — every other team's bench depth is either too thin to offer, or wouldn't actually upgrade either side's starting lineup.</p></div>`;
  }
  return `
    <div class="card">
      <h3>Suggested trades</h3>
      <p class="muted small">Scanned every team's roster for a bench player on each side that would actually improve the other's starting lineup — not just a fair value swap, a need fit.</p>
      <ul class="plain-list">
        ${suggestions
          .map(
            (s, i) => `
          <li class="trade-suggestion">
            <span>Send <b>${escapeHtml(s.give.name)}</b> (${escapeHtml(s.give.defaultPosition)}) to <b>${escapeHtml(s.partnerName)}</b>,
              get <b>${escapeHtml(s.receive.name)}</b> (${escapeHtml(s.receive.defaultPosition)}) —
              upgrades your ${escapeHtml(s.receive.defaultPosition)} spot and their ${escapeHtml(s.give.defaultPosition)} spot.</span>
            <button type="button" class="btn-ghost trade-suggestion-btn" data-index="${i}">Build this</button>
          </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

function gradeClass(grade) {
  if (!grade) return '';
  return `grade-${grade[0].toLowerCase()}`;
}

function gradesHtml(yourGrade, theirGrade) {
  if (!yourGrade && !theirGrade) return '';
  const one = (label, g) =>
    g ? `<div class="trade-grade"><span class="muted small">${label}</span><span class="grade-letter ${gradeClass(g)}">${escapeHtml(g)}</span></div>` : '';
  return `<div class="trade-grades">${one('Your grade', yourGrade)}${one('Their grade', theirGrade)}</div>`;
}

function verdictBadgeClass(verdict) {
  if (verdict === 'favors_you') return 'badge-out callout-ok';
  if (verdict === 'favors_them') return 'badge-warn';
  return '';
}

function renderAiResult(result) {
  const move = (items, render) =>
    items && items.length ? `<ul class="plain-list">${items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>` : '';
  return `
    <div class="card ai-result">
      ${gradesHtml(result.yourGrade, result.theirGrade)}
      <p class="ai-headline">${escapeHtml(result.headline)}</p>
      ${move(result.reasoning, (r) => escapeHtml(r))}
      <div class="ai-move-group">
        <h4>Roster impact</h4>
        <p><b>You:</b> ${escapeHtml(result.rosterImpact.you)}</p>
        <p><b>Them:</b> ${escapeHtml(result.rosterImpact.them)}</p>
      </div>
      ${result.risks && result.risks.length ? `<div class="ai-move-group"><h4>Risks</h4>${move(result.risks, (r) => escapeHtml(r))}</div>` : ''}
    </div>`;
}

const CONFIDENCE_CLASS = { confirmed: 'badge-out callout-ok', reported: 'badge-warn', rumor: 'badge-out' };

function renderGrokResult({ opinion, rawText, sources }) {
  const sourcesHtml = sources.length
    ? `<div class="ai-move-group"><h4>Sources</h4><ul class="plain-list">${sources
        .map((u) => `<li class="small"><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60))}</a></li>`)
        .join('')}</ul></div>`
    : '';
  if (!opinion) {
    return `<div class="card ai-result"><h3>Grok second opinion</h3><p class="muted small">Grok's reply wasn't in the expected format, so here it is as written.</p><p style="white-space:pre-wrap">${escapeHtml(rawText)}</p>${sourcesHtml}</div>`;
  }
  const list = (items, render) =>
    items.length ? `<ul class="plain-list">${items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>` : '';
  const updates = list(
    opinion.playerUpdates,
    (u) =>
      `<b>${escapeHtml(u?.name)}</b>: ${escapeHtml(u?.status)}${
        u?.confidence ? ` <span class="badge ${CONFIDENCE_CLASS[u.confidence] || ''}">${escapeHtml(u.confidence)}</span>` : ''
      }<br><span class="muted small">${escapeHtml(u?.update)}</span>`
  );
  const history = list(
    opinion.history,
    (h) => `<b>${escapeHtml(h?.name)}</b>: <span class="muted small">${escapeHtml(h?.note)}</span>`
  );
  return `
    <div class="card ai-result">
      <h3>Grok second opinion</h3>
      ${gradesHtml(opinion.yourGrade, opinion.theirGrade)}
      ${opinion.verdict ? `<span class="badge ${verdictBadgeClass(opinion.verdict)}">${VERDICT_LABEL[opinion.verdict]}</span>` : ''}
      <p class="ai-headline">${escapeHtml(opinion.headline)}</p>
      ${updates ? `<div class="ai-move-group"><h4>Latest news</h4>${updates}</div>` : ''}
      ${history ? `<div class="ai-move-group"><h4>History (recalled, not from ESPN)</h4>${history}</div>` : ''}
      ${opinion.reasoning.length ? `<div class="ai-move-group"><h4>Reasoning</h4>${list(opinion.reasoning, (r) => escapeHtml(r))}</div>` : ''}
      ${opinion.risks.length ? `<div class="ai-move-group"><h4>Risks</h4>${list(opinion.risks, (r) => escapeHtml(r))}</div>` : ''}
      ${opinion.feedbackOnOtherAnalysis ? `<div class="ai-move-group"><h4>Feedback on the Claude analysis</h4><p>${escapeHtml(opinion.feedbackOnOtherAnalysis)}</p></div>` : ''}
      ${sourcesHtml}
    </div>`;
}

export function renderTrade(root, league) {
  if (!league.myTeam) {
    root.innerHTML = `<div class="card"><p>Couldn't find your team in this league's response.</p></div>`;
    return;
  }

  const otherTeams = league.teams.filter((t) => t.id !== league.myTeam.id);
  if (otherTeams.length === 0) {
    root.innerHTML = `<div class="card"><p>No other teams found in this league's response.</p></div>`;
    return;
  }

  if (state.partnerId == null || !otherTeams.some((t) => t.id === state.partnerId)) {
    state.partnerId = otherTeams[0].id;
  }
  const partner = otherTeams.find((t) => t.id === state.partnerId);

  const myRoster = league.myTeam.roster;
  const theirRoster = partner.roster || [];

  if (myRoster.length === 0 || theirRoster.length === 0) {
    root.innerHTML = `
      <div class="card">
        <p>Couldn't load a full roster for one or both teams from this league's response, so there's nothing to build a trade from right now.</p>
      </div>`;
    return;
  }

  const giving = myRoster.filter((p) => state.give.has(p.playerId));
  const receiving = theirRoster.filter((p) => state.receive.has(p.playerId));
  const evaluation = evaluateTrade(giving, receiving);
  const hasSelection = giving.length > 0 || receiving.length > 0;

  const summaryHtml = hasSelection
    ? `
      <div class="card trade-summary">
        <div class="trade-summary-row">
          <div><span class="muted small">You give</span><div class="num trade-summary-value">${fmtPts(evaluation.giveValue)}</div></div>
          <span class="trade-vs">⇄</span>
          <div><span class="muted small">You get</span><div class="num trade-summary-value">${fmtPts(evaluation.receiveValue)}</div></div>
        </div>
        ${gradesHtml(evaluation.yourGrade, evaluation.theirGrade)}
        <span class="badge ${verdictBadgeClass(evaluation.verdict)}">${VERDICT_LABEL[evaluation.verdict]}</span>
        ${evaluation.countMismatch ? `<p class="muted small">${giving.length}-for-${receiving.length} — uneven player counts affect roster-spot value beyond raw points.</p>` : ''}
        <p class="muted small">Grade is by recent scoring average only, not positional need. Run an AI analysis for a grade that weighs roster fit, injuries, and byes.</p>
      </div>`
    : `<div class="card"><p class="muted">Select players on each side to compare.</p></div>`;

  const aiConfig = loadAiConfig();
  const currentKey = JSON.stringify({ partnerId: state.partnerId, give: [...state.give].sort(), receive: [...state.receive].sort() });
  const cachedAi = aiResultKey === currentKey ? aiResult : null;
  const grokConfig = loadGrokConfig();
  const grokOn = grokReady(grokConfig);
  const cachedGrok = grokResultKey === currentKey ? grokResult : null;

  const suggestions = findLeagueTradeSuggestions(myRoster, otherTeams);

  root.innerHTML = `
    ${suggestionsHtml(suggestions)}

    <div class="card">
      <label class="field">
        <span>Trade partner</span>
        <select id="trade-partner">
          ${otherTeams.map((t) => `<option value="${t.id}" ${t.id === state.partnerId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
        </select>
      </label>
    </div>

    ${summaryHtml}

    <div class="trade-columns">
      <div class="roster-group">
        <h3>You give</h3>
        ${myRoster.map((p) => playerRow(p, 'give')).join('')}
      </div>
      <div class="roster-group">
        <h3>You get (${escapeHtml(partner.name)})</h3>
        ${theirRoster.map((p) => playerRow(p, 'receive')).join('')}
      </div>
    </div>

    ${
      hasSelection
        ? `<div class="ai-generate-row">
            <button type="button" id="trade-ai-btn" class="btn" ${aiConfig.enabled && aiConfig.apiKey ? '' : 'hidden'}>Get AI Trade Analysis</button>
            <span id="trade-ai-status" class="muted small"></span>
          </div>
          ${!(aiConfig.enabled && aiConfig.apiKey) ? '<p class="muted small">Enable AI assistance on the My Team tab to get a written analysis here.</p>' : ''}
          <div id="trade-ai-result">${cachedAi ? renderAiResult(cachedAi) : ''}</div>
          ${
            grokOn
              ? `<div class="ai-generate-row">
                  <button type="button" id="trade-grok-btn" class="btn">Get Grok second opinion</button>
                  <span id="trade-grok-status" class="muted small"></span>
                </div>`
              : '<p class="muted small">Add an xAI key under Grok on the My Team tab for a second opinion with live injury and performance news.</p>'
          }
          <div id="trade-grok-result">${cachedGrok ? renderGrokResult(cachedGrok) : ''}</div>`
        : ''
    }
  `;

  root.querySelectorAll('.trade-suggestion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = suggestions[Number(btn.dataset.index)];
      state.partnerId = s.partnerId;
      state.give = new Set([s.give.playerId]);
      state.receive = new Set([s.receive.playerId]);
      renderTrade(root, league);
    });
  });

  root.querySelector('#trade-partner').addEventListener('change', (e) => {
    state.partnerId = Number(e.target.value);
    state.give.clear();
    state.receive.clear();
    renderTrade(root, league);
  });

  root.querySelectorAll('.trade-check').forEach((el) => {
    el.addEventListener('change', (e) => {
      const side = e.target.dataset.side;
      const id = Number(e.target.dataset.id);
      if (e.target.checked) state[side].add(id);
      else state[side].delete(id);
      renderTrade(root, league);
    });
  });

  const grokBtn = root.querySelector('#trade-grok-btn');
  if (grokBtn) {
    grokBtn.addEventListener('click', async () => {
      const statusEl = root.querySelector('#trade-grok-status');
      const resultEl = root.querySelector('#trade-grok-result');
      grokBtn.disabled = true;
      statusEl.textContent = 'Searching the web and X…';
      statusEl.className = 'muted small';
      try {
        const claude = aiResultKey === currentKey ? aiResult : null;
        const summary = buildTradeAiSummary(league, partner, giving, receiving, claude);
        const result = await generateGrokTradeOpinion(summary, loadGrokConfig());
        grokResult = result;
        grokResultKey = currentKey;
        resultEl.innerHTML = renderGrokResult(result);
        statusEl.textContent = '';
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.className = 'muted small status-error';
      } finally {
        grokBtn.disabled = false;
      }
    });
  }

  const aiBtn = root.querySelector('#trade-ai-btn');
  if (aiBtn) {
    aiBtn.addEventListener('click', async () => {
      const statusEl = root.querySelector('#trade-ai-status');
      const resultEl = root.querySelector('#trade-ai-result');
      aiBtn.disabled = true;
      statusEl.textContent = 'Thinking…';
      statusEl.className = 'muted small';
      try {
        const summary = buildTradeAiSummary(league, partner, giving, receiving);
        const result = await generateTradeAnalysis(summary, loadAiConfig());
        aiResult = result;
        aiResultKey = currentKey;
        resultEl.innerHTML = renderAiResult(result);
        statusEl.textContent = '';
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.className = 'muted small status-error';
      } finally {
        aiBtn.disabled = false;
      }
    });
  }
}
