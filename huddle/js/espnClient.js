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

/** Rosters as of one completed week; each player's points for that week are read back out of it. */
export async function fetchRosterForWeek(config, week) {
  const url = new URL(config.workerUrl);
  url.searchParams.set('leagueId', config.leagueId);
  url.searchParams.set('year', config.year);
  url.searchParams.append('view', 'mRoster');
  url.searchParams.set('scoringPeriodId', String(week));
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

/** ESPN mixes single-week entries (statSplitTypeId 1) with season-total and rolling-window
 *  entries (other split ids, whose values are sums over many games) in one `stats` array. When
 *  the split id is present at all, only the single-week ones are valid per-week points. */
function weeklyOnly(stats) {
  const hasSplit = stats.some((s) => s.statSplitTypeId !== undefined);
  return hasSplit ? stats.filter((s) => s.statSplitTypeId === 1) : stats;
}

function findStat(stats, week, statSourceId) {
  if (!Array.isArray(stats)) return null;
  const entry = weeklyOnly(stats).find((s) => s.scoringPeriodId === week && s.statSourceId === statSourceId);
  return entry && typeof entry.appliedTotal === 'number' ? entry.appliedTotal : null;
}

/** Actual points from completed weeks before `throughWeek`, oldest first — trend data ESPN
 *  already includes in the same payload, just not the current week's single-stat lookup. */
function recentActualPoints(stats, throughWeek, count = Infinity) {
  if (!Array.isArray(stats) || throughWeek == null) return [];
  return weeklyOnly(stats)
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

/** This week's opponent abbreviation and home/away for an NFL team, or nulls if the schedule is unknown. */
function gameFor(proInfo, proTeamId, week) {
  const g = proInfo?.schedule?.[proTeamId]?.[week];
  return g ? { opponent: proTeamAbbrev(g.opp), home: g.home } : { opponent: null, home: null };
}

function normalizePlayerEntry(entry, week, proInfo) {
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
    recentActual: recentActualPoints(player.stats, week, 3),
    seasonLog: recentActualPoints(player.stats, week),
    proTeamId: player.proTeamId ?? null,
    byeWeek: proInfo?.byeWeeks?.[player.proTeamId] ?? null,
    ...gameFor(proInfo, player.proTeamId, week),
  };
}

/**
 * ESPN's `view=proTeams` response: each NFL team's bye week and, per scoring period, its game
 * (opponent and home/away). Undocumented, so every field is read defensively; anything missing
 * just means the matching feature (byes, opponent, home/road) renders nothing instead of breaking.
 * Returns plain objects so it survives the localStorage cache.
 */
export function buildProInfo(raw) {
  const proTeams = raw?.settings?.proTeams || raw?.proTeams;
  const byeWeeks = {};
  const schedule = {};
  const weeksWithGames = new Set();
  if (Array.isArray(proTeams)) {
    for (const t of proTeams) {
      if (!t || typeof t.id !== 'number') continue;
      if (typeof t.byeWeek === 'number') byeWeeks[t.id] = t.byeWeek;
      for (const [weekKey, games] of Object.entries(t.proGamesByScoringPeriod || {})) {
        const week = Number(weekKey);
        const game = Array.isArray(games) ? games[0] : null;
        if (!game || !Number.isFinite(week)) continue;
        const home = game.homeProTeamId === t.id;
        const opp = home ? game.awayProTeamId : game.homeProTeamId;
        if (typeof opp !== 'number') continue;
        (schedule[t.id] ||= {})[week] = { opp, home };
        weeksWithGames.add(week);
      }
    }
    // No explicit bye field: a week the league plays but this team doesn't is its bye.
    for (const t of proTeams) {
      if (!t || typeof t.id !== 'number' || byeWeeks[t.id] !== undefined || !schedule[t.id]) continue;
      const gap = [...weeksWithGames].filter((w) => !schedule[t.id][w]);
      if (gap.length === 1) byeWeeks[t.id] = gap[0];
    }
  }
  return { byeWeeks, schedule };
}

/** Turns the raw ESPN payload into the small shape every render/*.js module works from. */
export function normalizeLeague(raw, config) {
  const week = raw?.scoringPeriodId ?? raw?.status?.currentMatchupPeriod ?? null;
  const rawTeams = Array.isArray(raw?.teams) ? raw.teams : [];

  const proInfo = buildProInfo(raw);

  // Every team's roster, not just mine — `view=mRoster` returns the whole
  // league's rosters in one payload, not a per-team filtered one, which is
  // what lets the Trade tab show a trade partner's roster with no extra
  // request. (Least-tested assumption in this file: if a future ESPN
  // response only includes the requesting team's own roster.entries, other
  // teams' `roster` here comes back empty rather than breaking anything —
  // see ARCHITECTURE.md §7.)
  const teams = rawTeams.map((t) => ({
    id: t.id,
    name: teamDisplayName(t),
    abbrev: t.abbrev || null,
    wins: t.record?.overall?.wins ?? 0,
    losses: t.record?.overall?.losses ?? 0,
    ties: t.record?.overall?.ties ?? 0,
    pointsFor: t.record?.overall?.pointsFor ?? null,
    pointsAgainst: t.record?.overall?.pointsAgainst ?? null,
    roster: (t.roster?.entries || [])
      .map((e) => normalizePlayerEntry(e, week, proInfo))
      .filter(Boolean),
  }));

  const myTeamId = Number(config.teamId);
  const myRawTeam = rawTeams.find((t) => t.id === myTeamId) || null;
  const roster = teams.find((t) => t.id === myTeamId)?.roster || [];

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
    proInfo,
    teams,
    myTeam: myRawTeam ? { id: myRawTeam.id, name: teamDisplayName(myRawTeam), roster } : null,
    matchup,
    upcomingMatchups,
  };
}

/** Normalizes the free-agent/waiver pool response (a differently-shaped payload from the
 *  roster one — see worker/espn-proxy.js's `players=freeagents` handling). */
export function normalizeFreeAgents(raw, week, proInfo) {
  const list = Array.isArray(raw?.players) ? raw.players : [];
  // The free-agent payload usually carries no proTeams, so reuse the league payload's.
  const info = proInfo && Object.keys(proInfo.byeWeeks || {}).length + Object.keys(proInfo.schedule || {}).length > 0 ? proInfo : buildProInfo(raw);
  return list.map((entry) => normalizePlayerEntry(entry, week, info)).filter(Boolean);
}
