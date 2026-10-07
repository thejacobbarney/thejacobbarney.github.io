/**
 * Full-season weekly scoring history. ESPN's current-week roster payload only carries a week or
 * two of weekly stats per player, so "last 3 games" and the season log were thin. This asks the
 * same roster endpoint for each completed week (scoringPeriodId = N) and rebuilds each player's
 * week-by-week points from those answers. Completed weeks never change, so each one is fetched
 * once and kept in localStorage; a normal refresh makes no extra requests.
 *
 * Best effort by design: a week that fails to load or has no readable points is skipped and
 * retried next time, and the app works with whatever history it did get. See ARCHITECTURE.md.
 */

import { fetchRosterForWeek } from './espnClient.js';
import { STAT_SOURCE } from './constants.js';

const CONCURRENCY = 3;
const MAX_WEEKLY_POINTS = 100; // no single player scores this in one week; guards a misread field

const cacheKey = (config) => `huddle:history:v2:${config.leagueId}:${config.year}`;

function readCache(config) {
  try {
    const raw = localStorage.getItem(cacheKey(config));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(config, history) {
  try {
    localStorage.setItem(cacheKey(config), JSON.stringify(history));
  } catch {
    // best-effort only
  }
}

/**
 * Per playerId for one week, read from a roster payload requested for that week:
 * `{ a: actual points, p: ESPN's projection for that week or null }`. The projection is kept so
 * Huddle can later check how accurate ESPN's numbers were (see projection.js: backtest()).
 */
export function extractWeekPoints(raw, week) {
  const points = {};
  for (const team of Array.isArray(raw?.teams) ? raw.teams : []) {
    for (const entry of team?.roster?.entries || []) {
      const pool = entry?.playerPoolEntry;
      const player = pool?.player || entry?.player;
      if (player?.id == null) continue;

      const stats = Array.isArray(player.stats) ? player.stats : [];
      const weeklyStat = (source) =>
        stats.find(
          (s) =>
            s.scoringPeriodId === week &&
            s.statSourceId === source &&
            (s.statSplitTypeId === undefined || s.statSplitTypeId === 1) &&
            typeof s.appliedTotal === 'number'
        );
      const actual = weeklyStat(STAT_SOURCE.ACTUAL);
      let a = actual ? actual.appliedTotal : null;
      if (a === null && typeof pool?.appliedStatTotal === 'number') a = pool.appliedStatTotal;
      if (a === null || Math.abs(a) > MAX_WEEKLY_POINTS) continue;

      const proj = weeklyStat(STAT_SOURCE.PROJECTED);
      const p = proj && Math.abs(proj.appliedTotal) <= MAX_WEEKLY_POINTS ? proj.appliedTotal : null;
      points[player.id] = { a, p };
    }
  }
  return points;
}

/**
 * Loads (and caches) points for every completed week before `currentWeek`.
 * @returns {Promise<Record<number, Record<number, {a:number,p:number|null}>>>} week -> playerId -> points
 */
export async function loadSeasonHistory(config, currentWeek) {
  if (!currentWeek || currentWeek < 2) return {};
  const history = readCache(config);
  const missing = [];
  for (let w = 1; w < currentWeek; w++) if (!history[w]) missing.push(w);

  let changed = false;
  const queue = [...missing];
  const worker = async () => {
    while (queue.length) {
      const week = queue.shift();
      try {
        const points = extractWeekPoints(await fetchRosterForWeek(config, week), week);
        if (Object.keys(points).length > 0) {
          history[week] = points;
          changed = true;
        }
      } catch {
        // skip; retried on the next refresh
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
  if (changed) writeCache(config, history);
  return history;
}

/**
 * Rebuilds seasonLog and recentActual on every player from the history, keeping any weekly
 * points the player already had for weeks the history lacks. An exact 0 is treated as "did not
 * play" (injury, bye, inactive) and left out, so a bye week doesn't drag a player's average down.
 */
export function applyHistory(league, history) {
  const weeks = Object.keys(history || {});
  if (weeks.length === 0) return false;

  const rebuild = (p) => {
    const byWeek = new Map();
    for (const r of p.seasonLog || []) byWeek.set(r.week, r.points);
    for (const w of weeks) {
      const v = history[w][p.playerId]?.a;
      if (typeof v === 'number') byWeek.set(Number(w), v);
    }
    const log = [...byWeek]
      .filter(([, points]) => points !== 0)
      .map(([week, points]) => ({ week, points }))
      .sort((a, b) => a.week - b.week);
    p.seasonLog = log;
    p.recentActual = log.slice(-3);
  };

  for (const team of league.teams || []) (team.roster || []).forEach(rebuild);
  (league.freeAgents || []).forEach(rebuild);
  return true;
}
