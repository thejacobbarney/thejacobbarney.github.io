// ESPN Fantasy Football's internal IDs, as documented by the community
// (there is no official public schema — these come from years of reverse
// engineering by projects like cwendt94/espn-api). Kept in one place so a
// broken mapping is a one-line fix, not a hunt through render code.

export const PRO_TEAMS = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL',
  7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV',
  14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG',
  20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF',
  26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL',
  34: 'HOU',
};

// Lineup slot -> label, for the slot a player is CURRENTLY placed in on a
// roster (not their eligible positions). Only the ones a standard NFL
// fantasy league actually uses are named; anything else falls back to
// `Slot {id}` in render code rather than guessing.
export const LINEUP_SLOTS = {
  0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE',
  7: 'OP', 16: 'D/ST', 17: 'K', 20: 'Bench', 21: 'IR', 23: 'FLEX',
};

// A player's default/primary position (playerPoolEntry.player.defaultPositionId).
export const DEFAULT_POSITIONS = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST',
};

// Slots eligible to start a FLEX-type spot, used by the start/sit comparison
// in lineup.js — a FLEX starter should only be compared against bench
// players who could actually legally replace them.
export const FLEX_ELIGIBLE_POSITIONS = new Set(['RB', 'WR', 'TE']);

export const BENCH_SLOT_ID = 20;
export const IR_SLOT_ID = 21;

// statSourceId on a player's stat line: 0 = actual, 1 = projected.
export const STAT_SOURCE = { ACTUAL: 0, PROJECTED: 1 };

export function proTeamAbbrev(proTeamId) {
  return PRO_TEAMS[proTeamId] || '—';
}

export function lineupSlotLabel(slotId) {
  return LINEUP_SLOTS[slotId] || `Slot ${slotId}`;
}

export function defaultPositionLabel(positionId) {
  return DEFAULT_POSITIONS[positionId] || '—';
}
