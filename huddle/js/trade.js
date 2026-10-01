import { playerValue } from './lineup.js';

const EVEN_THRESHOLD = 2; // points/game — inside this band, call it a wash rather than a "winner"

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
    countMismatch: giving.length !== receiving.length,
  };
}
