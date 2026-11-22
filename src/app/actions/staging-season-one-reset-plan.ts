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
  now?: Date;
};

const EXPECTED_GROUPS = 15;
const EXPECTED_TEAMS_PER_GROUP = 8;
const EXPECTED_MATCHES_PER_GROUP = 56;
const EXPECTED_PARTICIPANTS = 120;

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
  for (const table of input.tables) {
    const data = table.data || {};
    const level = Number(data.level);
    const group = Number(data.group);
    const groupKey = `${level}:${group}`;
    if (!Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > 2 ** (level - 1) ||
        groups.has(groupKey)) {
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
      if (!id || id !== key || !Number.isInteger(rank) || rank < 1 ||
          rank > EXPECTED_TEAMS_PER_GROUP || ranks.has(rank) || participants.has(id)) {
        reasons.push('LEAGUE_PARTICIPANT_IDENTITY_INVALID');
        continue;
      }
      ranks.add(rank);
      participants.set(id, { level, group, rank, isBot: row?.isBot === true || id.startsWith('BOT_') });
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
    if (Number(data.season) !== 1 || String(data.leagueId || '') !== 'ALPHA' ||
        !participants.has(String(data.occupantId || '')) && String(data.status || '').toUpperCase() === 'OCCUPIED' ||
        slotKeys.has(key) || !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > 2 ** (level - 1) ||
        !Number.isInteger(rank) || rank < 1 || rank > 8) {
      reasons.push('LEAGUE_SLOT_IDENTITY_INVALID');
      continue;
    }
    slotKeys.add(key);
    if (String(data.status || '').toUpperCase() === 'OCCUPIED') {
      const occupantId = String(data.occupantId || '');
      const expected = [...participants.entries()].find(([, team]) =>
        team.level === level && team.group === group && team.rank === rank
      )?.[0];
      if (expected !== occupantId) reasons.push('OCCUPIED_SLOT_STANDINGS_MISMATCH');
      occupiedSlotIds.add(occupantId);
    }
  }
  if (input.slots.length !== EXPECTED_PARTICIPANTS || slotKeys.size !== EXPECTED_PARTICIPANTS) {
    reasons.push('LEAGUE_SLOT_COUNT_INVALID');
  }

  const matchCounts = new Map<string, number>();
  for (const match of input.matches) {
    const data = match.data || {};
    const level = Number(data.level || data.division);
    const group = Number(data.groupId || data.group);
    const key = `${level}:${group}`;
    if (Number(data.season) !== 1 || Number(data.version) !== 140 ||
        String(data.leagueId || '') !== 'ALPHA' ||
        !groups.has(key) || data.cupId || data.tournamentId ||
        !Number.isInteger(level) || !Number.isInteger(group)) {
      reasons.push('LEAGUE_MATCH_SCOPE_INVALID');
      continue;
    }
    matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
  }
  if (input.matches.length !== EXPECTED_GROUPS * EXPECTED_MATCHES_PER_GROUP ||
      [...groups].some(key => matchCounts.get(key) !== EXPECTED_MATCHES_PER_GROUP)) {
    reasons.push('LEAGUE_MATCH_COUNT_INVALID');
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
