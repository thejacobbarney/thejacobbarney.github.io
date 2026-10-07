/**
 * Huddle's own weekly projection, independent of ESPN's, plus the checks that test it.
 *
 * ESPN's projection is a black box that can lag real events (a starting RB is ruled out and his
 * backup's number doesn't move). This builds a separate estimate from things we can see and
 * explain, so the two can be compared and the gaps examined:
 *
 *   base         recency-weighted recent games, blended with the season average
 *   opportunity  a share of the production a same-position teammate on the same NFL team is
 *                missing because he is out (the "backup RB gets the touches" effect)
 *   matchup      how the opponent has treated that position so far, from this league's own data
 *   home/road    a small home bump and road discount
 *   availability OUT is zero, DOUBTFUL/QUESTIONABLE are discounted
 *
 * Every constant below is a stated assumption, not a fitted truth. Two functions check them
 * against the season so far: backtest() (does the base estimate beat ESPN's projection?) and
 * opportunityShares() (how much of an absent player's production did teammates actually pick up
 * in this league's history? It also tunes the opportunity share, shrunk toward the default).
 */

const RECENT_WEIGHTS = [0.5, 0.3, 0.2]; // most recent game first
const SEASON_BLEND = 0.35; // weight on the full-season average once there are 4+ games
const MIN_GAMES_FOR_MODEL = 1;

const AVAILABILITY = {
  OUT: 0,
  INJURY_RESERVE: 0,
  SUSPENSION: 0,
  PHYSICALLY_UNABLE_TO_PERFORM: 0,
  DOUBTFUL: 0.25,
  QUESTIONABLE: 0.9,
  DAY_TO_DAY: 0.9,
};

const OPPORTUNITY_POSITIONS = ['RB', 'WR', 'TE'];
const DEFAULT_OPPORTUNITY_SHARE = { RB: 0.5, WR: 0.35, TE: 0.45 };
const MIN_STARTER_VALUE = { RB: 6, WR: 6, TE: 5 }; // points/game before a player's absence matters
const MAX_OPPORTUNITY_BOOST = 8;
const SHARE_PRIOR_EVENTS = 5; // how many observed events it takes to outweigh the default share

const MATCHUP_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const MATCHUP_SHRINK_GAMES = 8;
const MATCHUP_MIN_GAMES = 4;
const MATCHUP_CAP = [0.88, 1.12];
const HOME_FACTOR = 1.03;
const AWAY_FACTOR = 0.97;

/** Divergence worth surfacing: at least this many points AND this share of the projection. */
export const DIVERGENCE_MIN_POINTS = 3;
export const DIVERGENCE_MIN_SHARE = 0.25;

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function availability(injuryStatus) {
  return AVAILABILITY[injuryStatus] ?? 1;
}

/** Chronological played-game points (zeros are did-not-play and already excluded from seasonLog). */
const gamesOf = (player) => (player.seasonLog || []).map((r) => r.points);

/**
 * Recency-weighted estimate from chronological game points. Pure, so backtest() can run the
 * exact same function on only the games that came before each week.
 * @returns {{ value: number, games: number } | null}
 */
export function baseEstimate(points) {
  if (!points || points.length < MIN_GAMES_FOR_MODEL) return null;
  const recent = points.slice(-RECENT_WEIGHTS.length).reverse();
  const weights = RECENT_WEIGHTS.slice(0, recent.length);
  const weighted = recent.reduce((sum, p, i) => sum + p * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
  const value = points.length >= 4 ? (1 - SEASON_BLEND) * weighted + SEASON_BLEND * mean(points) : weighted;
  return { value, games: points.length };
}

function allPlayers(league) {
  const seen = new Set();
  const out = [];
  for (const team of league.teams || []) {
    for (const p of team.roster || []) {
      if (!seen.has(p.playerId)) {
        seen.add(p.playerId);
        out.push(p);
      }
    }
  }
  for (const p of league.freeAgents || []) {
    if (!seen.has(p.playerId)) {
      seen.add(p.playerId);
      out.push(p);
    }
  }
  return out;
}

/** Sorted completed weeks that have history. */
const weeksOf = (history) => Object.keys(history || {}).map(Number).sort((a, b) => a - b);

/**
 * How much of an absent player's production his same-position teammates picked up, measured from
 * this league's history: for each week a productive RB/WR/TE did not play (0 points while his
 * team did), the extra points his teammates scored over their own prior averages, divided by the
 * production he was missing. Shrunk toward the default share when there are few events.
 * @returns {Record<string, { share: number, empirical: number|null, events: number }>}
 */
export function opportunityShares(league, history) {
  const players = allPlayers(league).filter((p) => OPPORTUNITY_POSITIONS.includes(p.defaultPosition) && p.proTeamId != null);
  const groups = new Map();
  for (const p of players) {
    const key = `${p.proTeamId}:${p.defaultPosition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const totals = {};
  for (const pos of OPPORTUNITY_POSITIONS) totals[pos] = { extra: 0, lost: 0, events: 0 };

  const weeks = weeksOf(history);
  const priorAvg = (id, week) => {
    const prior = weeks.filter((w) => w < week).map((w) => history[w]?.[id]?.a).filter((a) => typeof a === 'number' && a !== 0);
    return prior.length >= 2 ? mean(prior) : null;
  };

  for (const group of groups.values()) {
    const pos = group[0].defaultPosition;
    for (const week of weeks) {
      if (group[0].byeWeek === week) continue;
      const rows = group
        .map((p) => ({ id: p.playerId, a: history[week]?.[p.playerId]?.a, prior: priorAvg(p.playerId, week) }))
        .filter((r) => typeof r.a === 'number');
      const absent = rows.filter((r) => r.a === 0 && r.prior !== null && r.prior >= MIN_STARTER_VALUE[pos]);
      const active = rows.filter((r) => r.a > 0 && r.prior !== null);
      if (absent.length === 0 || active.length === 0) continue;
      totals[pos].lost += absent.reduce((s, r) => s + r.prior, 0);
      totals[pos].extra += active.reduce((s, r) => s + (r.a - r.prior), 0);
      totals[pos].events += absent.length;
    }
  }

  const result = {};
  for (const pos of OPPORTUNITY_POSITIONS) {
    const { extra, lost, events } = totals[pos];
    const empirical = lost > 0 ? extra / lost : null;
    const base = DEFAULT_OPPORTUNITY_SHARE[pos];
    const share =
      empirical === null
        ? base
        : Math.min(0.9, Math.max(0, (events * empirical + SHARE_PRIOR_EVENTS * base) / (events + SHARE_PRIOR_EVENTS)));
    result[pos] = { share, empirical, events };
  }
  return result;
}

/**
 * How each NFL defense has treated each position so far: the average of opposing players' points
 * relative to their own season average, shrunk toward 1 for small samples.
 * @returns {Record<string, { factor: number, games: number }>} keyed `${oppProTeamId}:${position}`
 */
export function matchupFactors(league, history) {
  const sums = new Map();
  const weeks = weeksOf(history);
  for (const p of allPlayers(league)) {
    if (!MATCHUP_POSITIONS.includes(p.defaultPosition) || p.proTeamId == null) continue;
    const games = weeks
      .map((w) => ({ w, a: history[w]?.[p.playerId]?.a }))
      .filter((g) => typeof g.a === 'number' && g.a !== 0);
    if (games.length < 3) continue;
    const avg = mean(games.map((g) => g.a));
    if (avg < 3) continue;
    for (const g of games) {
      const opp = league.proInfo?.schedule?.[p.proTeamId]?.[g.w]?.opp;
      if (opp === undefined) continue;
      const key = `${opp}:${p.defaultPosition}`;
      const cur = sums.get(key) || { total: 0, games: 0 };
      cur.total += g.a / avg;
      cur.games += 1;
      sums.set(key, cur);
    }
  }
  const out = {};
  for (const [key, { total, games }] of sums) {
    const raw = total / games;
    const shrunk = 1 + (raw - 1) * (games / (games + MATCHUP_SHRINK_GAMES));
    out[key] = { factor: Math.min(MATCHUP_CAP[1], Math.max(MATCHUP_CAP[0], shrunk)), games };
  }
  return out;
}

/** Players' value for opportunity math: their own base estimate, else ESPN's projection. */
function valueForOpportunity(p) {
  const base = baseEstimate(gamesOf(p));
  if (base) return base.value;
  return typeof p.projected === 'number' ? p.projected : 0;
}

/**
 * Builds Huddle's projection for every rostered player and free agent and stores it on the player
 * as `player.huddle`, plus `league.validation` (backtest and opportunity calibration).
 * Safe to call repeatedly (before and after the history loads); `history` may be empty.
 */
export function annotateProjections(league, history) {
  const players = allPlayers(league);
  const shares = opportunityShares(league, history);
  const matchups = matchupFactors(league, history);

  const groups = new Map();
  for (const p of players) {
    if (!OPPORTUNITY_POSITIONS.includes(p.defaultPosition) || p.proTeamId == null) continue;
    const key = `${p.proTeamId}:${p.defaultPosition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const boostFor = new Map(); // playerId -> { boost, because: [] }
  for (const group of groups.values()) {
    const pos = group[0].defaultPosition;
    const hurt = group
      .map((p) => ({ p, lost: valueForOpportunity(p) * (1 - availability(p.injuryStatus)) }))
      .filter((h) => h.lost > 0 && valueForOpportunity(h.p) >= MIN_STARTER_VALUE[pos]);
    if (hurt.length === 0) continue;
    const healthy = group.filter((p) => availability(p.injuryStatus) > 0.5 && p.byeWeek !== league.week);
    if (healthy.length === 0) continue;
    const lostTotal = hurt.reduce((s, h) => s + h.lost, 0);
    const pool = lostTotal * shares[pos].share;
    const weightOf = (p) => Math.max(valueForOpportunity(p), 1);
    const weightSum = healthy.reduce((s, p) => s + weightOf(p), 0);
    for (const p of healthy) {
      const boost = Math.min(MAX_OPPORTUNITY_BOOST, (pool * weightOf(p)) / weightSum);
      boostFor.set(p.playerId, {
        boost,
        because: hurt.map((h) => `${h.p.name} (${round1(valueForOpportunity(h.p))}/game, ${String(h.p.injuryStatus).replace('_', ' ').toLowerCase()})`),
      });
    }
  }

  for (const p of players) {
    p.huddle = projectPlayer(p, league, boostFor.get(p.playerId), matchups);
  }

  league.validation = {
    backtest: backtest(league, history),
    opportunity: shares,
  };
  return league;
}

function projectPlayer(p, league, opportunity, matchups) {
  const components = [];
  const game = baseEstimate(gamesOf(p));
  let value;
  let basis;
  if (game) {
    value = game.value;
    basis = 'recent games';
    if (game.games < 3 && typeof p.projected === 'number') {
      const weight = game.games / 3;
      value = game.value * weight + p.projected * (1 - weight);
      components.push({ label: `Recent form (${game.games} game${game.games > 1 ? 's' : ''}), blended with ESPN's until 3+ games`, delta: value });
    } else {
      components.push({ label: `Recent form (${game.games} games)`, delta: value });
    }
  } else if (typeof p.projected === 'number') {
    value = p.projected;
    basis = 'espn';
    components.push({ label: "No game history yet, using ESPN's projection as the base", delta: value });
  } else {
    return { value: null, basis: 'none', components, games: 0 };
  }

  const add = (label, next) => {
    components.push({ label, delta: next - value });
    value = next;
  };

  if (opportunity && opportunity.boost > 0.05) {
    add(`More opportunity: ${opportunity.because.join('; ')}`, value + opportunity.boost);
  }

  if (MATCHUP_POSITIONS.includes(p.defaultPosition)) {
    const oppId = p.proTeamId != null ? league.proInfo?.schedule?.[p.proTeamId]?.[league.week]?.opp : undefined;
    const f = oppId !== undefined ? matchups[`${oppId}:${p.defaultPosition}`] : undefined;
    if (f && f.games >= MATCHUP_MIN_GAMES && Math.abs(f.factor - 1) >= 0.02) {
      const pct = Math.round((f.factor - 1) * 100);
      add(`Opponent ${p.opponent} vs ${p.defaultPosition} (${pct > 0 ? '+' : ''}${pct}%, ${f.games} games)`, value * f.factor);
    }
    if (p.home === true) add('Home game', value * HOME_FACTOR);
    else if (p.home === false) add('Road game', value * AWAY_FACTOR);
  }

  const avail = availability(p.injuryStatus);
  if (avail < 1) {
    add(`${String(p.injuryStatus).replace('_', ' ').toLowerCase()} (${Math.round(avail * 100)}% chance to play)`, value * avail);
  }
  if (p.byeWeek != null && p.byeWeek === league.week) {
    add('Bye week', 0);
  }

  return { value: round1(Math.max(0, value)), basis, components, games: game ? game.games : 0 };
}

/** True when Huddle's number is far enough from ESPN's to be worth showing. */
export function diverges(p) {
  if (!p.huddle || p.huddle.value === null || typeof p.projected !== 'number') return false;
  const diff = Math.abs(p.huddle.value - p.projected);
  return diff >= DIVERGENCE_MIN_POINTS && diff / Math.max(p.projected, DIVERGENCE_MIN_POINTS) >= DIVERGENCE_MIN_SHARE;
}

/** The single biggest reason Huddle differs from its own base, for a one-line explanation. */
export function mainReason(p) {
  const adjustments = (p.huddle?.components || []).slice(1).filter((c) => Math.abs(c.delta) > 0.05);
  if (adjustments.length === 0) return p.huddle?.basis === 'recent games' ? 'Recent scoring differs from ESPN\'s projection' : '';
  return adjustments.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a)).label;
}

/**
 * How accurate each projection has been this season. For every completed week where a player
 * played, has 3+ earlier games, and has an ESPN projection on record, compares Huddle's base
 * estimate (computed from only the games before that week) and ESPN's projection against what
 * he actually scored. Weeks a player didn't play are left out for both. Tests the base estimate
 * only: past injuries and matchups aren't recorded, so the adjustments can't be replayed.
 * @returns {{ n: number, espn: object, huddle: object, huddleCloser: number, byPosition: object } | null}
 */
export function backtest(league, history) {
  const weeks = weeksOf(history);
  if (weeks.length < 4) return null;

  const rows = [];
  for (const p of allPlayers(league)) {
    for (let i = 0; i < weeks.length; i++) {
      const week = weeks[i];
      const entry = history[week]?.[p.playerId];
      if (!entry || entry.a === 0 || entry.p == null) continue;
      const prior = weeks
        .slice(0, i)
        .map((w) => history[w]?.[p.playerId]?.a)
        .filter((a) => typeof a === 'number' && a !== 0);
      if (prior.length < 3) continue;
      const mine = baseEstimate(prior).value;
      rows.push({ pos: p.defaultPosition, actual: entry.a, espn: entry.p, huddle: mine });
    }
  }
  if (rows.length < 10) return null;

  const summarize = (list) => {
    const mae = (key) => mean(list.map((r) => Math.abs(r.actual - r[key])));
    const bias = (key) => mean(list.map((r) => r[key] - r.actual));
    return {
      n: list.length,
      espn: { mae: round1(mae('espn')), bias: round1(bias('espn')) },
      huddle: { mae: round1(mae('huddle')), bias: round1(bias('huddle')) },
      huddleCloser: Math.round(
        (100 * list.filter((r) => Math.abs(r.actual - r.huddle) < Math.abs(r.actual - r.espn)).length) / list.length
      ),
    };
  };

  const byPosition = {};
  for (const pos of new Set(rows.map((r) => r.pos))) {
    const list = rows.filter((r) => r.pos === pos);
    if (list.length >= 8) byPosition[pos] = summarize(list);
  }
  return { ...summarize(rows), byPosition };
}

