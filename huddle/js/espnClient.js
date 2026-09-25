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
  ['mRoster', 'mTeam', 'mMatchup', 'mSettings'].forEach((v) => url.searchParams.append('view', v));
  if (week) url.searchParams.set('scoringPeriodId', String(week));
  if (config.swid) url.searchParams.set('swid', config.swid);
  if (config.espnS2) url.searchParams.set('espn_s2', config.espnS2);

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

function normalizePlayerEntry(entry, week) {
  const player = entry?.playerPoolEntry?.player;
  if (!player) return null;
  return {
    slotId: entry.lineupSlotId,
    slotLabel: lineupSlotLabel(entry.lineupSlotId),
    playerId: player.id,
    name: player.fullName || 'Unknown player',
    proTeam: proTeamAbbrev(player.proTeamId),
    defaultPosition: defaultPositionLabel(player.defaultPositionId),
    injuryStatus: player.injuryStatus || null,
    projected: findStat(player.stats, week, STAT_SOURCE.PROJECTED),
    actual: findStat(player.stats, week, STAT_SOURCE.ACTUAL),
  };
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

  const myTeamId = Number(config.teamId);
  const myRawTeam = rawTeams.find((t) => t.id === myTeamId) || null;
  const roster = myRawTeam
    ? (myRawTeam.roster?.entries || [])
        .map((e) => normalizePlayerEntry(e, week))
        .filter(Boolean)
    : [];

  let matchup = null;
  if (myRawTeam && week != null && Array.isArray(raw?.schedule)) {
    const game = raw.schedule.find(
      (m) => m.matchupPeriodId === week && (m.home?.teamId === myTeamId || m.away?.teamId === myTeamId)
    );
    if (game) {
      const mine = game.home?.teamId === myTeamId ? game.home : game.away;
      const theirs = game.home?.teamId === myTeamId ? game.away : game.home;
      const findName = (id) => teams.find((t) => t.id === id)?.name || `Team ${id}`;
      matchup = {
        week,
        myTeam: { id: mine.teamId, name: findName(mine.teamId), total: mine.totalPoints ?? null },
        opponent: theirs
          ? { id: theirs.teamId, name: findName(theirs.teamId), total: theirs.totalPoints ?? null }
          : null,
      };
    }
  }

  return {
    week,
    teams,
    myTeam: myRawTeam ? { id: myRawTeam.id, name: teamDisplayName(myRawTeam), roster } : null,
    matchup,
  };
}
