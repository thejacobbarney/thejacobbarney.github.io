/** League-position context the AI views can't see otherwise: where the user's team stands. */

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const record = (t) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;

/** @returns {object|null} compact standings summary for AI prompts */
export function standingsContext(league) {
  const teams = league.teams || [];
  if (!league.myTeam || teams.length === 0) return null;

  const byRecord = [...teams].sort((a, b) => b.wins - a.wins || (b.pointsFor ?? 0) - (a.pointsFor ?? 0));
  const byPoints = [...teams].sort((a, b) => (b.pointsFor ?? 0) - (a.pointsFor ?? 0));
  const mine = teams.find((t) => t.id === league.myTeam.id);
  if (!mine) return null;

  const rankOf = (list, t) => list.findIndex((x) => x.id === t.id) + 1;
  const leader = byRecord[0];
  const oppName = league.matchup?.opponent?.name;
  const opp = oppName ? teams.find((t) => t.name === oppName) : null;

  return {
    teamsInLeague: teams.length,
    myRecord: record(mine),
    myRank: `${ordinal(rankOf(byRecord, mine))} of ${teams.length}`,
    pointsForRank: `${ordinal(rankOf(byPoints, mine))} of ${teams.length}`,
    leader: { name: leader.name, record: record(leader) },
    thisWeekOpponent: opp
      ? { name: opp.name, record: record(opp), rank: `${ordinal(rankOf(byRecord, opp))} of ${teams.length}`, pointsForRank: `${ordinal(rankOf(byPoints, opp))} of ${teams.length}` }
      : null,
  };
}
