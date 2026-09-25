import { STAT_SOURCE, lineupSlotLabel, defaultPositionLabel, proTeamAbbrev } from './constants.js';

/**
 * Fetches the raw ESPN league payload through the person's own Worker proxy
 * (see worker/espn-proxy.js — ESPN's API has no CORS allowance for
 * third-party origins, so a direct browser fetch to ESPN is blocked before
 * it ever reaches their servers).
 */
export async function fetchLeague(config, { week } = {}) {
  const url = new URL(config.workerUrl);
  url.searchParams.set('leagueId', config.leagueId);
  url.searchParams.set('year', config.year);
  ['mRoster', 'mTeam', 'mMatchup', 'mSettings', 'proTeams'].forEach((v) => url.searchParams.append('view', v));
  if (week) url.searchParams.set('scoringPeriodId', String(week));
  if (config.swid) url.searchParams.set('swid', config.swid);
  if (config.espnS2) url.searchParams.set('espn_s2', config.espnS2);
  return fetchJson(url);
}

/** Fetches the pool of unrostered (free agent / waivers) players for waiver suggestions. */
export async function fetchFreeAgents(config, { week } = {}) {
  const url = new URL(config.workerUrl);
  url.searchParams.set('leagueId', config.leagueId);
  url.searchParams.set('year', config.year);
  url.searchParams.set('players', 'freeagents');
  if (week) url.searchParams.set('scoringPeriodId', String(week));
  if (config.swid) url.searchParams.set('swid', config.swid);
  if (config.espnS2) url.searchParams.set('espn_s2', config.espnS2);
  return fetchJson(url);
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error(
      "Couldn't reach the proxy. Check the Worker URL in Settings and that it's actually deployed."
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'ESPN rejected the request (401/403). For a private league, double check SWID and espn_s2 in Settings — they expire periodically and need refreshing from a logged-in ESPN browser session.'
      );
    }
    throw new Error(`ESPN request failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return res.json();
}

function teamDisplayName(team) {
  if (team.name) return team.name;
  const combined = `${team.location || ''} ${team.nickname || ''}`.trim();
  return combined || `Team ${team.id}`;
}

function findStat(stats, week, statSourceId) {
  if (!Array.isArray(stats)) return null;
  const entry = stats.find((s) => s.scoringPeriodId === week && s.statSourceId === statSourceId);
  return entry && typeof entry.appliedTotal === 'number' ? entry.appliedTotal : null;
}

/** Actual points from completed weeks before `throughWeek`, oldest first — trend data ESPN
 *  already includes in the same payload, just not the current week's single-stat lookup. */
function recentActualPoints(stats, throughWeek, count = 3) {
  if (!Array.isArray(stats) || throughWeek == null) return [];
  return stats
    .filter(
      (s) =>
        s.statSourceId === STAT_SOURCE.ACTUAL &&
        typeof s.appliedTotal === 'number' &&
        s.scoringPeriodId < throughWeek
    )
    .sort((a, b) => b.scoringPeriodId - a.scoringPeriodId)
    .slice(0, count)
    .map((s) => ({ week: s.scoringPeriodId, points: s.appliedTotal }))
    .reverse();
}

function normalizePlayerEntry(entry, week, byeWeekByProTeamId) {
  const player = entry?.playerPoolEntry?.player || entry?.player;
  if (!player) return null;
  return {
    slotId: entry.lineupSlotId ?? null,
    slotLabel: entry.lineupSlotId != null ? lineupSlotLabel(entry.lineupSlotId) : 'FA',
    playerId: player.id,
    name: player.fullName || 'Unknown player',
    proTeam: proTeamAbbrev(player.proTeamId),
    defaultPosition: defaultPositionLabel(player.defaultPositionId),
    injuryStatus: player.injuryStatus || null,
    projected: findStat(player.stats, week, STAT_SOURCE.PROJECTED),
    actual: findStat(player.stats, week, STAT_SOURCE.ACTUAL),
    recentActual: recentActualPoints(player.stats, week),
    byeWeek: byeWeekByProTeamId?.get(player.proTeamId) ?? null,
  };
}

/** ESPN's `view=proTeams` response — sourced defensively since this isn't documented anywhere;
 *  if the shape doesn't match, bye-week features just render nothing instead of breaking. */
function buildByeWeekMap(raw) {
  const proTeams = raw?.settings?.proTeams || raw?.proTeams;
  const map = new Map();
  if (Array.isArray(proTeams)) {
    for (const t of proTeams) {
      if (t && typeof t.id === 'number' && typeof t.byeWeek === 'number') {
        map.set(t.id, t.byeWeek);
      }
    }
  }
  return map;
}

/** Turns the raw ESPN payload into the small shape every render/*.js module works from. */
export function normalizeLeague(raw, config) {
  const week = raw?.scoringPeriodId ?? raw?.status?.currentMatchupPeriod ?? null;
  const rawTeams = Array.isArray(raw?.teams) ? raw.teams : [];

  const teams = rawTeams.map((t) => ({
    id: t.id,
    name: teamDisplayName(t),
    abbrev: t.abbrev || null,
    wins: t.record?.overall?.wins ?? 0,
    losses: t.record?.overall?.losses ?? 0,
    ties: t.record?.overall?.ties ?? 0,
    pointsFor: t.record?.overall?.pointsFor ?? null,
    pointsAgainst: t.record?.overall?.pointsAgainst ?? null,
  }));

  const byeWeekByProTeamId = buildByeWeekMap(raw);
  const myTeamId = Number(config.teamId);
  const myRawTeam = rawTeams.find((t) => t.id === myTeamId) || null;
  const roster = myRawTeam
    ? (myRawTeam.roster?.entries || [])
        .map((e) => normalizePlayerEntry(e, week, byeWeekByProTeamId))
        .filter(Boolean)
    : [];

  const findName = (id) => teams.find((t) => t.id === id)?.name || `Team ${id}`;

  let matchup = null;
  let upcomingMatchups = [];
  if (myRawTeam && week != null && Array.isArray(raw?.schedule)) {
    const myGames = raw.schedule.filter(
      (m) => m.home?.teamId === myTeamId || m.away?.teamId === myTeamId
    );
    const game = myGames.find((m) => m.matchupPeriodId === week);
    if (game) {
      const mine = game.home?.teamId === myTeamId ? game.home : game.away;
      const theirs = game.home?.teamId === myTeamId ? game.away : game.home;
      matchup = {
        week,
        myTeam: { id: mine.teamId, name: findName(mine.teamId), total: mine.totalPoints ?? null },
        opponent: theirs
          ? { id: theirs.teamId, name: findName(theirs.teamId), total: theirs.totalPoints ?? null }
          : null,
      };
    }
    upcomingMatchups = myGames
      .filter((m) => m.matchupPeriodId > week)
      .sort((a, b) => a.matchupPeriodId - b.matchupPeriodId)
      .slice(0, 4)
      .map((m) => {
        const theirs = m.home?.teamId === myTeamId ? m.away : m.home;
        return { week: m.matchupPeriodId, opponent: theirs ? findName(theirs.teamId) : 'BYE' };
      });
  }

  return {
    week,
    teams,
    myTeam: myRawTeam ? { id: myRawTeam.id, name: teamDisplayName(myRawTeam), roster } : null,
    matchup,
    upcomingMatchups,
  };
}

/** Normalizes the free-agent/waiver pool response (a differently-shaped payload from the
 *  roster one — see worker/espn-proxy.js's `players=freeagents` handling). */
export function normalizeFreeAgents(raw, week) {
  const list = Array.isArray(raw?.players) ? raw.players : [];
  const byeWeekByProTeamId = buildByeWeekMap(raw);
  return list.map((entry) => normalizePlayerEntry(entry, week, byeWeekByProTeamId)).filter(Boolean);
}
