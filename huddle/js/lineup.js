import { BENCH_SLOT_ID, IR_SLOT_ID, FLEX_ELIGIBLE_POSITIONS } from './constants.js';

const FLEX_SLOT_ID = 23;

function benchEligibleFor(starter, benchPlayers) {
  if (starter.slotId === FLEX_SLOT_ID) {
    return benchPlayers.filter((p) => FLEX_ELIGIBLE_POSITIONS.has(p.defaultPosition));
  }
  return benchPlayers.filter((p) => p.defaultPosition === starter.defaultPosition);
}

/** Huddle's projection when it has one, otherwise ESPN's: lets the same suggestion logic run on either. */
export const huddleProj = (p) => (typeof p.huddle?.value === 'number' ? p.huddle.value : p.projected);

/**
 * Compares each started player against the bench players who could legally
 * take their spot, using projected points for the week. Only returns cases
 * where a bench option projects *higher* — this is a suggestion list, not a
 * verdict, so it deliberately says nothing about players it can't compare
 * (missing projections, bye weeks with no stat line at all, etc.).
 */
export function findStartSitSuggestions(roster, projOf = (p) => p.projected) {
  const starters = roster.filter((p) => p.slotId !== BENCH_SLOT_ID && p.slotId !== IR_SLOT_ID);
  const bench = roster.filter((p) => p.slotId === BENCH_SLOT_ID);

  const suggestions = [];
  for (const starter of starters) {
    const starterProj = projOf(starter);
    if (typeof starterProj !== 'number') continue;
    const candidates = benchEligibleFor(starter, bench).filter(
      (p) => typeof projOf(p) === 'number' && projOf(p) > starterProj
    );
    if (candidates.length === 0) continue;
    const best = candidates.reduce((a, b) => (projOf(b) > projOf(a) ? b : a));
    suggestions.push({ starter, upgrade: best, delta: projOf(best) - starterProj });
  }
  return suggestions.sort((a, b) => b.delta - a.delta);
}

/**
 * A player's "roster value" for drop purposes: their recent scoring average
 * when we have it, falling back to this week's projection only if there's no
 * game history yet. This deliberately does NOT use this week's projection as
 * the primary signal — a single-week OUT/injury projects 0 and would
 * otherwise make a rostered star look like the weakest player on the team
 * every week he's hurt, which is a false signal, not a real drop case.
 */
export function playerValue(player) {
  if (player.recentActual && player.recentActual.length > 0) {
    const sum = player.recentActual.reduce((total, r) => total + r.points, 0);
    return sum / player.recentActual.length;
  }
  return typeof player.projected === 'number' ? player.projected : null;
}

/**
 * For each position on your roster, compares your weakest rostered player
 * (by roster value — see rosterValue() — IR excluded) against the best
 * available free agent's projection for the week at that same default
 * position. Only surfaces a case where the free agent projects higher — an
 * add/drop suggestion, not a full waiver-wire browse, and specifically not a
 * "your OUT stud is droppable" trap: a good recent-form average protects a
 * temporarily-injured player from looking like the weakest link.
 */
export function findWaiverUpgrades(roster, freeAgents, projOf = (p) => p.projected) {
  const rosteredByPos = new Map();
  for (const p of roster) {
    if (p.slotId === IR_SLOT_ID || playerValue(p) === null) continue;
    const list = rosteredByPos.get(p.defaultPosition) || [];
    list.push(p);
    rosteredByPos.set(p.defaultPosition, list);
  }

  const faByPos = new Map();
  for (const p of freeAgents) {
    if (typeof projOf(p) !== 'number') continue;
    const list = faByPos.get(p.defaultPosition) || [];
    list.push(p);
    faByPos.set(p.defaultPosition, list);
  }

  const suggestions = [];
  for (const [pos, rosteredList] of rosteredByPos) {
    const weakest = rosteredList.reduce((a, b) => (playerValue(b) < playerValue(a) ? b : a));
    const weakestValue = playerValue(weakest);
    const candidates = (faByPos.get(pos) || []).filter((fa) => projOf(fa) > weakestValue);
    if (candidates.length === 0) continue;
    const best = candidates.reduce((a, b) => (projOf(b) > projOf(a) ? b : a));
    suggestions.push({ drop: weakest, add: best, delta: projOf(best) - weakestValue });
  }
  return suggestions.sort((a, b) => b.delta - a.delta);
}
