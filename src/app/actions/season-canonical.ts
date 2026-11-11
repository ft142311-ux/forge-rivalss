export const CANONICAL_MAX_LEVELS = 4;
export const CANONICAL_TEAMS_PER_GROUP = 8;
export const CANONICAL_TOTAL_GROUPS = 15;
export const CANONICAL_TOTAL_MATCHES = 840;
export const CANONICAL_TOTAL_SLOTS = 120;
export const CANONICAL_LEAGUE_ID = 'ALPHA';

type CanonicalDocument = Record<string, any>;

export type CanonicalReadiness = {
  ready: boolean;
  observedCanonicalMatches: number;
  observedCanonicalSlots: number;
  observedCanonicalTables: number;
  reasons: string[];
};

function validGroup(level: any, group: any) {
  const l = Number(level);
  const g = Number(group);
  return Number.isInteger(l) && l >= 1 && l <= CANONICAL_MAX_LEVELS &&
    Number.isInteger(g) && g >= 1 && g <= Math.pow(2, l - 1);
}

function groupKey(level: any, group: any) {
  return `${Number(level)}-${Number(group)}`;
}

function documentData(value: any): CanonicalDocument {
  return value && typeof value.data === 'function' ? value.data() || {} : value || {};
}

/** Pure canonical-world validator. It performs no Firebase reads or writes. */
export function evaluateCanonicalDocuments({
  tables,
  slots,
  matches,
  leagueId = CANONICAL_LEAGUE_ID,
}: {
  tables: CanonicalDocument[];
  slots: CanonicalDocument[];
  matches: CanonicalDocument[];
  leagueId?: string;
}): CanonicalReadiness {
  const reasons: string[] = [];
  const tableKeys = new Set<string>();
  const teamIds = new Set<string>();
  const teamLocations = new Map<string, string>();
  const teamsByGroup = new Map<string, Set<string>>();

  for (const rawTable of tables) {
    const table = documentData(rawTable);
    if (String(table.leagueId || '') !== leagueId) {
      reasons.push('TABLE_LEAGUE_INVALID');
      continue;
    }
    const level = Number(table.level);
    const group = Number(table.group);
    if (!validGroup(level, group)) {
      reasons.push('INVALID_TABLE_COORDINATE');
      continue;
    }

    const location = groupKey(level, group);
    if (tableKeys.has(location)) {
      reasons.push('DUPLICATE_TABLE_GROUP');
      continue;
    }
    tableKeys.add(location);

    const stats = table.stats && typeof table.stats === 'object' ? table.stats : null;
    if (!stats || Object.keys(stats).length !== CANONICAL_TEAMS_PER_GROUP) {
      reasons.push('TABLE_TEAM_COUNT_INVALID');
      continue;
    }

    const ranks = new Set<number>();
    for (const [key, rawRow] of Object.entries(stats)) {
      const row = rawRow && typeof rawRow === 'object' ? rawRow as CanonicalDocument : {};
      const id = String(row.id ?? '').trim();
      const rank = Number(row.rank);
      if (!id || !Number.isInteger(rank) || rank < 1 || rank > CANONICAL_TEAMS_PER_GROUP || ranks.has(rank)) {
        reasons.push('TABLE_RANK_OR_ID_INVALID');
        continue;
      }
      if (teamIds.has(id)) reasons.push('DUPLICATE_TEAM_ID');
      teamIds.add(id);
      ranks.add(rank);
      if (!teamsByGroup.has(location)) teamsByGroup.set(location, new Set<string>());
      teamsByGroup.get(location)!.add(id);
      const previousLocation = teamLocations.get(id);
      if (previousLocation && previousLocation !== location) reasons.push('TEAM_IN_MULTIPLE_GROUPS');
      teamLocations.set(id, location);
    }
    if (ranks.size !== CANONICAL_TEAMS_PER_GROUP) reasons.push('TABLE_RANK_SET_INVALID');
  }

  const slotKeys = new Set<string>();
  const occupantIds = new Set<string>();
  const occupantLocations = new Map<string, string>();
  const occupantsByGroup = new Map<string, Set<string>>();
  for (const rawSlot of slots) {
    const slot = documentData(rawSlot);
    const level = Number(slot.division ?? slot.level);
    const group = Number(slot.group);
    const rank = Number(slot.rank);
    if (!validGroup(level, group) || !Number.isInteger(rank) || rank < 1 || rank > CANONICAL_TEAMS_PER_GROUP) {
      reasons.push('INVALID_SLOT_COORDINATE');
      continue;
    }

    const location = `${groupKey(level, group)}-${rank}`;
    if (slotKeys.has(location)) {
      reasons.push('DUPLICATE_SLOT_COORDINATE');
      continue;
    }
    slotKeys.add(location);

    const occupant = String(slot.occupantId || '');
    const status = String(slot.status || '');
    if (status && status !== 'FREE' && status !== 'OCCUPIED') reasons.push('INVALID_SLOT_STATUS');
    if (status === 'OCCUPIED' && !occupant) reasons.push('OCCUPIED_SLOT_WITHOUT_TEAM');
    if (status === 'FREE' && occupant) reasons.push('FREE_SLOT_WITH_TEAM');
    if (!occupant) continue;

    if (occupant.startsWith('BOT_')) reasons.push('BOT_OCCUPIES_SLOT');
    if (occupantIds.has(occupant)) reasons.push('DUPLICATE_SLOT_OCCUPANT');
    occupantIds.add(occupant);
    const previousLocation = occupantLocations.get(occupant);
    if (previousLocation && previousLocation !== groupKey(level, group)) reasons.push('OCCUPANT_IN_MULTIPLE_GROUPS');
    occupantLocations.set(occupant, groupKey(level, group));
    const groupId = groupKey(level, group);
    if (!teamsByGroup.get(groupId)?.has(occupant)) reasons.push('TABLE_SLOT_PARTICIPANT_MISMATCH');
    if (!occupantsByGroup.has(groupId)) occupantsByGroup.set(groupId, new Set<string>());
    occupantsByGroup.get(groupId)!.add(occupant);
  }

  for (const [groupId, ids] of teamsByGroup) {
    for (const id of ids) {
      if (!id.startsWith('BOT_') && !occupantsByGroup.get(groupId)?.has(id)) reasons.push('HUMAN_TEAM_WITHOUT_MATCHING_SLOT');
    }
  }

  const fixtureKeys = new Set<string>();
  const fixtureCounts = new Map<string, number>();
  const fixtureParticipantsByRank = new Map<string, string>();
  let canonicalMatchCount = 0;
  for (const rawMatch of matches) {
    const match = documentData(rawMatch);
    const level = Number(match.level);
    const group = Number(match.groupId);
    const homeRank = Number(match.homeRank);
    const awayRank = Number(match.awayRank);
    if (!validGroup(level, group) ||
        !Number.isInteger(homeRank) || homeRank < 1 || homeRank > CANONICAL_TEAMS_PER_GROUP ||
        !Number.isInteger(awayRank) || awayRank < 1 || awayRank > CANONICAL_TEAMS_PER_GROUP ||
        homeRank === awayRank) {
      reasons.push('INVALID_MATCH_COORDINATE');
      continue;
    }
    canonicalMatchCount++;
    const groupId = groupKey(level, group);
    const key = `${groupId}-${homeRank}-${awayRank}`;
    if (fixtureKeys.has(key)) reasons.push('DUPLICATE_MATCH_COORDINATE');
    fixtureKeys.add(key);
    const homeId = String(match.homeId || '');
    const awayId = String(match.awayId || '');
    const expectedHome = teamsByGroup.get(groupId)?.has(homeId) === true;
    const expectedAway = teamsByGroup.get(groupId)?.has(awayId) === true;
    const homeRankKey = `${groupId}-${homeRank}`;
    const awayRankKey = `${groupId}-${awayRank}`;
    if (!homeId || !awayId || homeId === awayId || !expectedHome || !expectedAway ||
        (fixtureParticipantsByRank.has(homeRankKey) && fixtureParticipantsByRank.get(homeRankKey) !== homeId) ||
        (fixtureParticipantsByRank.has(awayRankKey) && fixtureParticipantsByRank.get(awayRankKey) !== awayId)) {
      reasons.push('MATCH_PARTICIPANT_TABLE_MISMATCH');
    }
    fixtureParticipantsByRank.set(homeRankKey, homeId);
    fixtureParticipantsByRank.set(awayRankKey, awayId);
    fixtureCounts.set(groupId, (fixtureCounts.get(groupId) || 0) + 1);
  }

  for (const rawSlot of slots) {
    const slot = documentData(rawSlot);
    const occupant = String(slot.occupantId || '');
    if (!occupant) continue;
    const location = `${groupKey(slot.division ?? slot.level, slot.group)}-${Number(slot.rank)}`;
    if (fixtureParticipantsByRank.get(location) !== occupant) reasons.push('SLOT_FIXTURE_PARTICIPANT_MISMATCH');
  }

  if (tableKeys.size !== CANONICAL_TOTAL_GROUPS || tables.length !== CANONICAL_TOTAL_GROUPS) reasons.push('TABLE_COUNT_INVALID');
  if (slotKeys.size !== CANONICAL_TOTAL_SLOTS || slots.length !== CANONICAL_TOTAL_SLOTS) reasons.push('SLOT_COUNT_INVALID');
  if (canonicalMatchCount !== CANONICAL_TOTAL_MATCHES || fixtureKeys.size !== CANONICAL_TOTAL_MATCHES) reasons.push('MATCH_COUNT_INVALID');
  for (const count of fixtureCounts.values()) if (count !== 56) reasons.push('GROUP_MATCH_COUNT_INVALID');

  return {
    ready: reasons.length === 0,
    observedCanonicalMatches: fixtureKeys.size,
    observedCanonicalSlots: slotKeys.size,
    observedCanonicalTables: tableKeys.size,
    reasons: [...new Set(reasons)],
  };
}
