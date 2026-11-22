export type FreshSeasonOneResetInput = {
  config: Record<string, any> | null;
  tables: Array<{ id: string; data: Record<string, any> }>;
  slots: Array<{ id: string; data: Record<string, any> }>;
  matches: Array<{ id: string; data: Record<string, any> }>;
  profileIds: Set<string>;
  cup: Record<string, any> | null;
  cupFixtures: Array<{ id: string; data: Record<string, any> }>;
  cupSnapshots: Array<{ id: string; data: Record<string, any> }>;
  archives: number;
  rollovers: number;
  history: number;
  archiveMatches: number;
  matchPlayerEffects: number;
  matchRevenueReceipts: number;
  cupMatchRevenueReceipts: number;
  matchConsequenceReceipts: number;
  leagueSeasonRewardReceipts: number;
  pyramidCupRewardReceipts: number;
  liveLocks: string[];
  unclassifiedMatches: number;
  now?: Date;
};

const EXPECTED_GROUPS = 15;
const EXPECTED_TEAMS_PER_GROUP = 8;
const EXPECTED_MATCHES_PER_GROUP = 56;
const EXPECTED_PARTICIPANTS = 120;
const EXPECTED_TOURS = 14;

function toValidDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date
    ? new Date(value.getTime())
    : value && typeof value.toDate === 'function'
      ? value.toDate()
      : new Date(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

function expectedCupOpeningTime(seasonStart: Date): number {
  const date = new Date(seasonStart.getTime() + 86400000);
  date.setUTCHours(4, 0, 0, 0);
  return date.getTime();
}

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
  if (config.historyCleanupPending === true) reasons.push('SEASON_HISTORY_CLEANUP_PENDING');
  if (!['REGULAR_SEASON', 'ACTIVE'].includes(String(config.phase || '').toUpperCase())) reasons.push('SEASON_PHASE_NOT_RESETTABLE');
  if (input.liveLocks.length) reasons.push('SEASON_WORKER_LOCKED');
  if (input.unclassifiedMatches > 0) reasons.push('UNCLASSIFIED_SEASON_MATCH_DOCUMENTS');

  // The current Cup and fixtures are disposable Season 1 test data.
  // The new Cup is generated after the league calendar has been rebuilt.
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

  // Existing S1 league fixtures are intentionally replaceable. They are
  // not a prerequisite for a new season and will be removed before rebuilding.
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
      playerIdentityDevelopmentConditionAndContracts: true,
      lifetimeMatchAndCareerTitleCounters: true,
    },
    replace: {
      leagueMatches: input.matches.length,
      cupExists: Boolean(input.cup),
      cupMatches: input.cupFixtures.length,
      cupParticipantSnapshots: input.cupSnapshots.length,
      seasonArchives: input.archives,
      rolloverPlans: input.rollovers,
      seasonHistoryEntries: input.history,
      playerSeasonStatsChemistryDisciplineAndSeasonOneAwardReferences: true,
      seasonOnePlayerMatchEconomyReferences: true,
      archivedLeagueMatches: input.archiveMatches,
      matchPlayerEffectLedgers: input.matchPlayerEffects,
      matchRevenueReceipts: input.matchRevenueReceipts,
      cupMatchRevenueReceipts: input.cupMatchRevenueReceipts,
      matchConsequenceReceipts: input.matchConsequenceReceipts,
      leagueSeasonRewardReceipts: input.leagueSeasonRewardReceipts,
      pyramidCupRewardReceipts: input.pyramidCupRewardReceipts,
      activeWorkerLocks: input.liveLocks.length,
      unclassifiedSeasonMatches: input.unclassifiedMatches,
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
