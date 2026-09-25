import { BENCH_SLOT_ID, IR_SLOT_ID, FLEX_ELIGIBLE_POSITIONS } from './constants.js';

const FLEX_SLOT_ID = 23;

function benchEligibleFor(starter, benchPlayers) {
  if (starter.slotId === FLEX_SLOT_ID) {
    return benchPlayers.filter((p) => FLEX_ELIGIBLE_POSITIONS.has(p.defaultPosition));
  }
  return benchPlayers.filter((p) => p.defaultPosition === starter.defaultPosition);
}

/**
 * Compares each started player against the bench players who could legally
 * take their spot, using projected points for the week. Only returns cases
 * where a bench option projects *higher* — this is a suggestion list, not a
 * verdict, so it deliberately says nothing about players it can't compare
 * (missing projections, bye weeks with no stat line at all, etc.).
 */
export function findStartSitSuggestions(roster) {
  const starters = roster.filter((p) => p.slotId !== BENCH_SLOT_ID && p.slotId !== IR_SLOT_ID);
  const bench = roster.filter((p) => p.slotId === BENCH_SLOT_ID);

  const suggestions = [];
  for (const starter of starters) {
    if (typeof starter.projected !== 'number') continue;
    const candidates = benchEligibleFor(starter, bench).filter(
      (p) => typeof p.projected === 'number' && p.projected > starter.projected
    );
    if (candidates.length === 0) continue;
    const best = candidates.reduce((a, b) => (b.projected > a.projected ? b : a));
    suggestions.push({ starter, upgrade: best, delta: best.projected - starter.projected });
  }
  return suggestions.sort((a, b) => b.delta - a.delta);
}
