/** Result cards shared by every AI view (Claude, Grok, Perplexity) and the final analysis. */

import { escapeHtml, sourceLinksHtml } from '../utils.js';

export const VERDICT_LABEL = { favors_you: 'Favors you', favors_them: 'Favors them', even: 'Roughly even' };

export function verdictBadgeClass(verdict) {
  if (verdict === 'favors_you') return 'badge-good';
  if (verdict === 'favors_them') return 'badge-warn';
  return '';
}

const CONFIDENCE_CLASS = { confirmed: 'badge-good', reported: 'badge-warn', rumor: 'badge-out' };
const MOVE_VERDICT = { go: ['Go', 'badge-good'], wait: ['Wait', 'badge-warn'], skip: ['Skip', 'badge-out'] };
const SYNTH_CONFIDENCE = { high: 'badge-good', medium: 'badge-warn', low: 'badge-out' };

function gradeClass(grade) {
  return grade ? `grade-${grade[0].toLowerCase()}` : '';
}

export function gradesHtml(yourGrade, theirGrade) {
  if (!yourGrade && !theirGrade) return '';
  const one = (label, g) =>
    g
      ? `<div class="trade-grade"><span class="muted small">${label}</span><span class="grade-letter ${gradeClass(g)}">${escapeHtml(g)}</span></div>`
      : '';
  return `<div class="trade-grades">${one('Your grade', yourGrade)}${one('Their grade', theirGrade)}</div>`;
}

function list(items, render) {
  return items && items.length ? `<ul class="plain-list">${items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>` : '';
}

function group(title, html) {
  return html ? `<div class="ai-move-group"><h4>${escapeHtml(title)}</h4>${html}</div>` : '';
}

function newsItem(u) {
  return `<b>${escapeHtml(u.name)}</b>: ${escapeHtml(u.status)}${
    u.confidence ? ` <span class="badge ${CONFIDENCE_CLASS[u.confidence] || ''}">${escapeHtml(u.confidence)}</span>` : ''
  }<br><span class="muted small">${escapeHtml(u.update)}</span>`;
}

function rawFallback(title, { rawText, sources }) {
  return `<div class="card ai-result"><h3>${escapeHtml(title)}</h3><p class="muted small">The reply wasn't in the expected format, so here it is as written.</p><p style="white-space:pre-wrap">${escapeHtml(rawText)}</p>${sourceLinksHtml(sources)}</div>`;
}

export function renderTradeCard(title, res) {
  const d = res.data;
  if (!d) return rawFallback(title, res);
  return `
    <div class="card ai-result">
      <h3>${escapeHtml(title)}</h3>
      ${gradesHtml(d.yourGrade, d.theirGrade)}
      ${d.verdict ? `<span class="badge ${verdictBadgeClass(d.verdict)}">${VERDICT_LABEL[d.verdict]}</span>` : ''}
      <p class="ai-headline">${escapeHtml(d.headline)}</p>
      ${group('Latest news', list(d.playerUpdates, newsItem))}
      ${group('History (recalled, not from ESPN)', list(d.history, (h) => `<b>${escapeHtml(h.name)}</b>: <span class="muted small">${escapeHtml(h.note)}</span>`))}
      ${group('Reasoning', list(d.reasoning, escapeHtml))}
      ${group('Risks', list(d.risks, escapeHtml))}
      ${d.feedbackOnOtherAnalysis ? group('Feedback on the Claude analysis', `<p>${escapeHtml(d.feedbackOnOtherAnalysis)}</p>`) : ''}
      ${sourceLinksHtml(res.sources)}
    </div>`;
}

export function renderWaiverCard(title, res) {
  const d = res.data;
  if (!d) return rawFallback(title, res);
  const moves = list(d.moves, (m) => {
    const [label, cls] = MOVE_VERDICT[m.verdict] || [null, ''];
    return `<b>Add ${escapeHtml(m.add)}, drop ${escapeHtml(m.drop)}</b>
      ${label ? `<span class="badge ${cls}">${label}</span>` : ''}
      ${m.grade ? `<span class="grade-letter grade-inline ${gradeClass(m.grade)}">${escapeHtml(m.grade)}</span>` : ''}
      <br><span class="muted small"><b>Add:</b> ${escapeHtml(m.newsOnAdd)}</span>
      <br><span class="muted small"><b>Drop:</b> ${escapeHtml(m.newsOnDrop)}</span>
      <br><span class="small">${escapeHtml(m.reasoning)}</span>`;
  });
  return `
    <div class="card ai-result">
      <h3>${escapeHtml(title)}</h3>
      <p class="ai-headline">${escapeHtml(d.headline)}</p>
      ${group('Suggested moves', moves)}
      ${group('Other pickups to consider', list(d.betterTargets, (t) => `<b>${escapeHtml(t.name)}</b>: <span class="muted small">${escapeHtml(t.why)}</span>`))}
      ${group('Notes', list(d.notes, escapeHtml))}
      ${sourceLinksHtml(res.sources)}
    </div>`;
}

export function renderLineupCard(title, res) {
  const d = res.data;
  if (!d) return rawFallback(title, res);
  return `
    <div class="card ai-result">
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      <p class="ai-headline">${escapeHtml(d.headline)}</p>
      ${group('Lineup', list(d.lineupMoves, (m) => `<b>${escapeHtml(m.action.toUpperCase())}</b> ${escapeHtml(m.player)}: ${escapeHtml(m.reasoning)}`))}
      ${group('Waiver wire', list(d.waiverMoves, (m) => `Add <b>${escapeHtml(m.add)}</b>, drop <b>${escapeHtml(m.drop)}</b>: ${escapeHtml(m.reasoning)}`))}
      ${group('Latest news', list(d.playerNews, newsItem))}
      ${group('Watch before lineups lock', list(d.watchList, escapeHtml))}
      ${sourceLinksHtml(res.sources)}
    </div>`;
}

export function renderSynthesisCard(s) {
  return `
    <div class="card ai-result ai-final-result">
      <h3>Final analysis</h3>
      <span class="badge ${SYNTH_CONFIDENCE[s.confidence] || ''}">${escapeHtml(s.confidence)} confidence</span>
      <p class="ai-headline">${escapeHtml(s.headline)}</p>
      <div class="ai-move-group">
        <h4>Final recommendation</h4>
        <p><b>${escapeHtml(s.finalRecommendation.action)}</b></p>
        <p class="small">${escapeHtml(s.finalRecommendation.rationale)}</p>
      </div>
      ${group(
        'Common themes',
        list(
          s.commonThemes,
          (t) => `<b>${escapeHtml(t.theme)}</b> <span class="muted small">(${escapeHtml(t.agreedBy.join(', '))})</span><br><span class="small">${escapeHtml(t.detail)}</span>`
        )
      )}
      ${group(
        'Key differences',
        list(
          s.keyDifferences,
          (k) => `<b>${escapeHtml(k.topic)}</b>
            ${list(k.positions, (p) => `<span class="small"><b>${escapeHtml(p.source)}:</b> ${escapeHtml(p.position)}</span>`)}
            <span class="muted small">How to resolve: ${escapeHtml(k.howToResolve)}</span>`
        )
      )}
      ${group('Check before acting', list(s.openQuestions, escapeHtml))}
    </div>`;
}
