export type FreshSeasonOneResetInput = {
  config: Record<string, any> | null;
  tables: Array<{ id: string; data: Record<string, any> }>;
  slots: Array<{ id: string; data: Record<string, any> }>;
  matches: Array<{ id: string; data: Record<string, any> }>;
  profileIds: Set<string>;
  cupExists: boolean;
  cupMatches: number;
  cupSnapshots: number;
  archives: number;
  rollovers: number;
  history: number;
  archiveMatches: number;
  matchPlayerEffects: number;
  matchRevenueReceipts: number;
  now?: Date;
};

const EXPECTED_GROUPS = 15;
const EXPECTED_TEAMS_PER_GROUP = 8;
const EXPECTED_MATCHES_PER_GROUP = 56;
const EXPECTED_PARTICIPANTS = 120;
const EXPECTED_TOURS = 14;

function nextMoscowSeasonBoundary(now: Date) {
  const next = new Date(now.getTime());
  next.setUTCHours(15, 0, 0, 0); // 18:00 Moscow time
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function buildFreshSeasonOneResetPlan(input: FreshSeasonOneResetInput) {
  const reasons: string[] = [];
  const config = input.config || {};
  if (!input.config) reasons.push('SEASON_CONFIG_MISSING');
  if (Number(config.activeSeasonNumber) !== 1) reasons.push('ACTIVE_SEASON_MUST_BE_1');
  if (config.worldReady !== true) reasons.push('ACTIVE_WORLD_NOT_READY');
  if (Number(config.preparedSeasonNumber || 0) > 1 || config.preparedWorldReady === true) {
    reasons.push('PREPARED_NEXT_SEASON_EXISTS');
  }
  if (config.stagingSeasonOneResetInProgress === true) reasons.push('RESET_ALREADY_IN_PROGRESS');

  const groups = new Set<string>();
  const participants = new Map<string, { level: number; group: number; rank: number; isBot: boolean }>();
  const participantsByCoordinate = new Map<string, string>();
  for (const table of input.tables) {
    const data = table.data || {};
    const level = Number(data.level);
    const group = Number(data.group);
    const groupKey = `${level}:${group}`;
    if (!Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > 2 ** (level - 1) ||
        groups.has(groupKey) ||
        table.id !== `table_v140_S1_LALPHA_V${level}_G${group}`) {
      reasons.push('LEAGUE_TABLE_COORDINATES_INVALID');
      continue;
    }
    groups.add(groupKey);
    const stats = data.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      reasons.push('LEAGUE_STANDINGS_INVALID');
      continue;
    }
    const rows = Object.entries(stats);
    const ranks = new Set<number>();
    if (rows.length !== EXPECTED_TEAMS_PER_GROUP) reasons.push('LEAGUE_GROUP_TEAM_COUNT_INVALID');
    for (const [key, raw] of rows) {
      const row = raw as Record<string, any>;
      const id = String(row?.id || key);
      const rank = Number(row?.rank);
      const coordinate = `${level}:${group}:${rank}`;
      if (!id || id !== key || !Number.isInteger(rank) || rank < 1 ||
          rank > EXPECTED_TEAMS_PER_GROUP || ranks.has(rank) || participants.has(id) ||
          participantsByCoordinate.has(coordinate)) {
        reasons.push('LEAGUE_PARTICIPANT_IDENTITY_INVALID');
        continue;
      }
      ranks.add(rank);
      participants.set(id, { level, group, rank, isBot: row?.isBot === true || id.startsWith('BOT_') });
      participantsByCoordinate.set(coordinate, id);
    }
    if (ranks.size !== EXPECTED_TEAMS_PER_GROUP) reasons.push('LEAGUE_GROUP_RANKS_INVALID');
  }
  if (groups.size !== EXPECTED_GROUPS || input.tables.length !== EXPECTED_GROUPS) {
    reasons.push('LEAGUE_TABLE_COUNT_INVALID');
  }
  if (participants.size !== EXPECTED_PARTICIPANTS) reasons.push('PARTICIPANT_COUNT_INVALID');

  const slotKeys = new Set<string>();
  const occupiedSlotIds = new Set<string>();
  for (const slot of input.slots) {
    const data = slot.data || {};
    const level = Number(data.division || data.level);
    const group = Number(data.group);
    const rank = Number(data.rank);
    const key = `${level}:${group}:${rank}`;
    const status = String(data.status || '').toUpperCase();
    const occupantId = String(data.occupantId || '');
    const expectedParticipant = participantsByCoordinate.get(key) || '';
    const expectedSlotId = `S1_LALPHA_D${level}_G${group}_R${rank}`;
    if (Number(data.season) !== 1 || String(data.leagueId || '') !== 'ALPHA' ||
        slot.id !== expectedSlotId || !expectedParticipant ||
        slotKeys.has(key) || !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > 2 ** (level - 1) ||
        !Number.isInteger(rank) || rank < 1 || rank > 8 ||
        !['FREE', 'OCCUPIED'].includes(status)) {
      reasons.push('LEAGUE_SLOT_IDENTITY_INVALID');
      continue;
    }
    slotKeys.add(key);
    if (status === 'OCCUPIED') {
      if (!occupantId || occupantId !== expectedParticipant || expectedParticipant.startsWith('BOT_')) {
        reasons.push('OCCUPIED_SLOT_STANDINGS_MISMATCH');
      }
      occupiedSlotIds.add(occupantId);
    } else if (occupantId || !expectedParticipant.startsWith('BOT_')) {
      reasons.push('FREE_SLOT_STANDINGS_MISMATCH');
    }
  }
  if (input.slots.length !== EXPECTED_PARTICIPANTS || slotKeys.size !== EXPECTED_PARTICIPANTS) {
    reasons.push('LEAGUE_SLOT_COUNT_INVALID');
  }

  const matchCounts = new Map<string, number>();
  const fixturesByGroup = new Map<string, Array<{ id: string; data: Record<string, any> }>>();
  for (const match of input.matches) {
    const data = match.data || {};
    const level = Number(data.level || data.division);
    const group = Number(data.groupId || data.group);
    const key = `${level}:${group}`;
    const tour = Number(data.tour);
    const homeId = String(data.homeId || '');
    const awayId = String(data.awayId || '');
    const home = participants.get(homeId);
    const away = participants.get(awayId);
    const homeRank = Number(data.homeRank);
    const awayRank = Number(data.awayRank);
    const expectedId = `match_v140_S1_LALPHA_V${level}_G${group}_T${tour}_R${homeRank}_vs_R${awayRank}`;
    if (Number(data.season) !== 1 || Number(data.version) !== 140 ||
        String(data.leagueId || '') !== 'ALPHA' ||
        !groups.has(key) || data.cupId || data.tournamentId ||
        !Number.isInteger(level) || !Number.isInteger(group) ||
        !Number.isInteger(tour) || tour < 1 || tour > EXPECTED_TOURS ||
        !home || !away || homeId === awayId ||
        home.level !== level || home.group !== group || home.rank !== homeRank ||
        away.level !== level || away.group !== group || away.rank !== awayRank ||
        match.id !== expectedId) {
      reasons.push('LEAGUE_MATCH_SCOPE_INVALID');
      continue;
    }
    matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
    const fixtures = fixturesByGroup.get(key) || [];
    fixtures.push(match);
    fixturesByGroup.set(key, fixtures);
  }
  if (input.matches.length !== EXPECTED_GROUPS * EXPECTED_MATCHES_PER_GROUP ||
      [...groups].some(key => matchCounts.get(key) !== EXPECTED_MATCHES_PER_GROUP)) {
    reasons.push('LEAGUE_MATCH_COUNT_INVALID');
  }

  // Validate the complete double round-robin shape, not merely 56 documents.
  for (const groupKey of groups) {
    const fixtures = fixturesByGroup.get(groupKey) || [];
    const tourTeams = new Map<number, Set<string>>();
    const appearances = new Map<string, number>();
    const pairings = new Map<string, Array<{ home: string; away: string }>>();
    for (const fixture of fixtures) {
      const data = fixture.data;
      const tour = Number(data.tour);
      const homeId = String(data.homeId);
      const awayId = String(data.awayId);
      const used = tourTeams.get(tour) || new Set<string>();
      if (used.has(homeId) || used.has(awayId)) reasons.push('LEAGUE_MATCH_ROUND_ROBIN_INVALID');
      used.add(homeId);
      used.add(awayId);
      tourTeams.set(tour, used);
      appearances.set(homeId, (appearances.get(homeId) || 0) + 1);
      appearances.set(awayId, (appearances.get(awayId) || 0) + 1);
      const pairKey = [homeId, awayId].sort().join('|');
      const pair = pairings.get(pairKey) || [];
      pair.push({ home: homeId, away: awayId });
      pairings.set(pairKey, pair);
    }
    if (tourTeams.size !== EXPECTED_TOURS ||
        [...tourTeams.values()].some(teams => teams.size !== EXPECTED_TEAMS_PER_GROUP) ||
        [...participants.entries()].filter(([, team]) => `${team.level}:${team.group}` === groupKey)
          .some(([id]) => appearances.get(id) !== EXPECTED_TOURS) ||
        pairings.size !== (EXPECTED_TEAMS_PER_GROUP * (EXPECTED_TEAMS_PER_GROUP - 1)) / 2 ||
        [...pairings.values()].some(pair => pair.length !== 2 ||
          pair[0].home !== pair[1].away || pair[0].away !== pair[1].home)) {
      reasons.push('LEAGUE_MATCH_ROUND_ROBIN_INVALID');
    }
  }

  let validProfiles = 0;
  if (participants.size === EXPECTED_PARTICIPANTS) {
    for (const id of participants.keys()) if (input.profileIds.has(id)) validProfiles++;
  }
  if (validProfiles !== EXPECTED_PARTICIPANTS) reasons.push('PARTICIPANT_PROFILE_MISSING');

  const now = input.now instanceof Date ? input.now : new Date();
  const seasonStart = nextMoscowSeasonBoundary(now);
  const nextSeasonStart = new Date(seasonStart.getTime() + 17 * 86400000);
  const uniqueReasons = [...new Set(reasons)];
  return {
    ready: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    target: {
      season: 1,
      phase: 'REGULAR_SEASON',
      seasonStart: seasonStart.toISOString(),
      nextSeasonStart: nextSeasonStart.toISOString(),
      durationDays: 17,
      worldGeneration: 'CLEAN_S1_V1',
    },
    preserve: {
      participantProfiles: validProfiles,
      occupiedHumanClubs: [...occupiedSlotIds].filter(id => !id.startsWith('BOT_')).length,
      leagueSlots: input.slots.length,
      allPlayerProfiles: true,
      accountCredentials: true,
    },
    replace: {
      leagueMatches: input.matches.length,
      cupExists: input.cupExists,
      cupMatches: input.cupMatches,
      cupParticipantSnapshots: input.cupSnapshots,
      seasonArchives: input.archives,
      rolloverPlans: input.rollovers,
      seasonHistoryEntries: input.history,
      archivedLeagueMatches: input.archiveMatches,
      matchPlayerEffectLedgers: input.matchPlayerEffects,
      matchRevenueReceipts: input.matchRevenueReceipts,
    },
    expected: {
      groups: EXPECTED_GROUPS,
      tables: EXPECTED_GROUPS,
      slots: EXPECTED_PARTICIPANTS,
      leagueMatches: EXPECTED_GROUPS * EXPECTED_MATCHES_PER_GROUP,
      participants: EXPECTED_PARTICIPANTS,
      cupMatches: 119,
      cupOpeningMatches: 56,
      d1RestingTeams: 8,
    },
  };
}
