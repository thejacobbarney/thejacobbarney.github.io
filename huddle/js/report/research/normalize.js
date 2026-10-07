/** Tolerant parsing of live-search provider replies into the shapes the UI renders. */

import { GRADES } from '../../trade.js';

const asArray = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v == null ? '' : String(v));

export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const news = (n) => ({
  name: str(n?.name),
  status: str(n?.status),
  update: str(n?.update),
  confidence: str(n?.confidence),
});

export function normalizeTrade(p) {
  if (!p) return null;
  return {
    verdict: ['favors_you', 'favors_them', 'even'].includes(p.verdict) ? p.verdict : null,
    yourGrade: GRADES.includes(p.yourGrade) ? p.yourGrade : null,
    theirGrade: GRADES.includes(p.theirGrade) ? p.theirGrade : null,
    headline: str(p.headline),
    playerUpdates: asArray(p.playerUpdates).map(news),
    history: asArray(p.history).map((h) => ({ name: str(h?.name), note: str(h?.note) })),
    reasoning: asArray(p.reasoning).map(str),
    risks: asArray(p.risks).map(str),
    feedbackOnOtherAnalysis: typeof p.feedbackOnOtherAnalysis === 'string' ? p.feedbackOnOtherAnalysis : null,
  };
}

export function normalizeWaiver(p) {
  if (!p) return null;
  return {
    headline: str(p.headline),
    moves: asArray(p.moves).map((m) => ({
      add: str(m?.add),
      drop: str(m?.drop),
      verdict: ['go', 'wait', 'skip'].includes(m?.verdict) ? m.verdict : null,
      grade: GRADES.includes(m?.grade) ? m.grade : null,
      newsOnAdd: str(m?.newsOnAdd),
      newsOnDrop: str(m?.newsOnDrop),
      reasoning: str(m?.reasoning),
    })),
    betterTargets: asArray(p.betterTargets).map((t) => ({ name: str(t?.name), why: str(t?.why) })),
    notes: asArray(p.notes).map(str),
  };
}

export function normalizeLineup(p) {
  if (!p) return null;
  return {
    headline: str(p.headline),
    lineupMoves: asArray(p.lineupMoves).map((m) => ({
      action: ['start', 'sit', 'monitor'].includes(m?.action) ? m.action : 'monitor',
      player: str(m?.player),
      reasoning: str(m?.reasoning),
    })),
    waiverMoves: asArray(p.waiverMoves).map((m) => ({
      add: str(m?.add),
      drop: str(m?.drop),
      reasoning: str(m?.reasoning),
    })),
    playerNews: asArray(p.playerNews).map(news),
    watchList: asArray(p.watchList).map(str),
  };
}
