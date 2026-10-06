import { playerValue } from './lineup.js';
import { IR_SLOT_ID } from './constants.js';

const EVEN_THRESHOLD = 2; // points/game — inside this band, call it a wash rather than a "winner"

// A standard league's starting lineup by default position, ignoring FLEX —
// a simplification documented in ARCHITECTURE.md: a true FLEX-eligible
// surplus (e.g. a 3rd good RB in a league that starts 2 RB + 1 FLEX) can be
// undercounted as "need" here, but the alternative (modeling FLEX exactly)
// needs this league's actual roster/slot settings, which aren't fetched.
const STANDARD_STARTER_COUNTS = { QB: 1, RB: 2, WR: 2, TE: 1, 'D/ST': 1, K: 1 };

function starterCountFor(position) {
  return STANDARD_STARTER_COUNTS[position] ?? 1;
}

/** Groups a roster's non-IR players by default position, sorted by playerValue() descending. */
function groupByPosition(roster) {
  const byPos = new Map();
  for (const p of roster) {
    if (p.slotId === IR_SLOT_ID) continue;
    const value = playerValue(p);
    if (value === null) continue;
    const list = byPos.get(p.defaultPosition) || [];
    list.push({ player: p, value });
    byPos.set(p.defaultPosition, list);
  }
  for (const list of byPos.values()) list.sort((a, b) => b.value - a.value);
  return byPos;
}

/** The value of this team's worst starter at a position — how good a replacement would need to
 *  be to actually improve their starting lineup there. Zero (treated as "wide open") if the team
 *  doesn't even have enough players to fill the standard starter count. */
function starterFloor(byPos, position) {
  const list = byPos.get(position) || [];
  const n = starterCountFor(position);
  return list.length >= n ? list[n - 1].value : 0;
}

/** Players beyond the standard starter count at a position — roster depth that isn't currently
 *  started, and so is available to trade without touching this team's own starting lineup. */
function surplusAt(byPos, position) {
  const list = byPos.get(position) || [];
  return list.slice(starterCountFor(position));
}

export const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

// Net points/game from one side's view needed to move that many steps off the middle grade
// (C+). The third cutoff is the same band as the "even" verdict, so a roughly-even trade never
// grades past B or C-. Symmetric on purpose: a trade that grades A+ for one side grades F for the other.
const GRADE_STEP_CUTOFFS = [0.5, 1, EVEN_THRESHOLD, 3.5, 5, 7];
const MIDDLE_GRADE = 6;

/** Letter grade for a net points/game change from one side's perspective. */
export function gradeForDelta(delta) {
  const steps = GRADE_STEP_CUTOFFS.filter((c) => Math.abs(delta) >= c).length;
  return GRADES[MIDDLE_GRADE - Math.sign(delta) * steps];
}

/**
 * Compares two lists of players by the same recent-form `playerValue()` used
 * for waiver suggestions — a season-form signal, not a single week's
 * projection, so a trade target who's merely on a bye this week doesn't look
 * like dead weight. Works for either direction: building an offer to send,
 * or plugging in an offer you received to check it.
 */
export function evaluateTrade(giving, receiving) {
  const sideTotal = (players) =>
    players.reduce((sum, p) => {
      const v = playerValue(p);
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);

  const giveValue = sideTotal(giving);
  const receiveValue = sideTotal(receiving);
  const delta = receiveValue - giveValue;

  let verdict = 'even';
  if (delta > EVEN_THRESHOLD) verdict = 'favors_you';
  else if (delta < -EVEN_THRESHOLD) verdict = 'favors_them';

  return {
    giveValue,
    receiveValue,
    delta,
    verdict,
    yourGrade: gradeForDelta(delta),
    theirGrade: gradeForDelta(-delta),
    countMismatch: giving.length !== receiving.length,
  };
}

/**
 * Scans every other team in the league for mutually-beneficial 1-for-1
 * trades: a spot where you have bench depth at a position (a player beyond
 * your standard starter count there) that would actually upgrade another
 * team's starting lineup, paired with a spot where they have the same kind
 * of spare at a position where YOU need the upgrade. Only candidates that
 * help both starting lineups are returned — a trade that's merely "fair" in
 * total value but doesn't address either side's actual roster need isn't
 * surfaced here (that's what the manual builder is for).
 *
 * Returns the top `limit` candidates league-wide, ranked by combined
 * improvement to both starting lineups.
 */
export function findLeagueTradeSuggestions(myRoster, otherTeams, { limit = 5 } = {}) {
  const myByPos = groupByPosition(myRoster);
  const suggestions = [];

  for (const team of otherTeams) {
    const theirByPos = groupByPosition(team.roster || []);
    if (theirByPos.size === 0) continue;

    for (const [myPos] of myByPos) {
      const theirNeedAtMyPos = starterFloor(theirByPos, myPos);
      for (const mySpare of surplusAt(myByPos, myPos)) {
        if (mySpare.value <= theirNeedAtMyPos) continue; // wouldn't actually upgrade their lineup

        for (const [theirPos] of theirByPos) {
          const myNeedAtTheirPos = starterFloor(myByPos, theirPos);
          for (const theirSpare of surplusAt(theirByPos, theirPos)) {
            if (theirSpare.value <= myNeedAtTheirPos) continue; // wouldn't actually upgrade my lineup

            suggestions.push({
              partnerId: team.id,
              partnerName: team.name,
              give: mySpare.player,
              receive: theirSpare.player,
              myGain: theirSpare.value - myNeedAtTheirPos,
              theirGain: mySpare.value - theirNeedAtMyPos,
              mutualBenefit: theirSpare.value - myNeedAtTheirPos + (mySpare.value - theirNeedAtMyPos),
            });
          }
        }
      }
    }
  }

  // Cap one suggestion per (give, receive) pair you'd see repeated across
  // position loops, and keep some partner variety near the top rather than
  // one team's depth chart dominating every slot.
  const seen = new Set();
  const deduped = suggestions.filter((s) => {
    const key = `${s.give.playerId}:${s.receive.playerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.sort((a, b) => b.mutualBenefit - a.mutualBenefit).slice(0, limit);
}
