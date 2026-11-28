import { buildBotClub } from './bot-roster';
import { createFreshSeasonOneHumanClubProfile, getFreshSeasonOneClubName } from './fresh-season-one-player-reset';

type SourceDoc = { id: string; data: Record<string, any> };
type FreshProfile = { id: string; data: Record<string, any> };

function coordinates(level: number, group: number, rank: number) {
  return {
    tableId: `table_v140_S1_LALPHA_V${level}_G${group}`,
    slotId: `S1_LALPHA_D${level}_G${group}_R${rank}`,
  };
}

/**
 * Builds a clean Season 1 league identity layer without touching Firebase Auth.
 * Existing human UIDs keep their exact rank; their players_v14 profiles and
 * rosters are replaced with fresh starter clubs. Every bot club is regenerated.
 */
export function buildFreshSeasonOneWorldDocuments(input: {
  tables: SourceDoc[];
  slots: SourceDoc[];
  profiles: Map<string, Record<string, any>>;
  now?: Date;
}) {
  const now = input.now || new Date();
  if (!Number.isFinite(now.getTime()) || input.tables.length !== 15 || input.slots.length !== 120) {
    throw new Error('FRESH_SEASON_ONE_SOURCE_SHAPE_INVALID');
  }

  const tableByCoordinate = new Map<string, SourceDoc>();
  const teamBySlot = new Map<string, { id: string; name: string; isBot: boolean; level: number; group: number; rank: number }>();
  const usedIds = new Set<string>();

  for (const table of input.tables) {
    const data = table.data || {};
    const level = Number(data.level);
    const group = Number(data.group);
    const key = `${level}:${group}`;
    if (!Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > 2 ** (level - 1) ||
        table.id !== coordinates(level, group, 1).tableId || tableByCoordinate.has(key)) {
      throw new Error('FRESH_SEASON_ONE_TABLE_COORDINATES_INVALID');
    }
    const stats = data.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats) || Object.keys(stats).length !== 8) {
      throw new Error('FRESH_SEASON_ONE_TABLE_STATS_INVALID');
    }
    tableByCoordinate.set(key, table);
    const ranks = new Set<number>();
    for (const [rowKey, raw] of Object.entries(stats)) {
      const row = raw as Record<string, any>;
      const id = String(row?.id || rowKey);
      const rank = Number(row?.rank);
      const botId = `BOT_ALPHA_L${level}_G${group}_R${rank}`;
      const isBot = row?.isBot === true || id.startsWith('BOT_');
      if (!id || id !== rowKey || usedIds.has(id) || !Number.isInteger(rank) || rank < 1 || rank > 8 ||
          ranks.has(rank) || (isBot && id !== botId) || (!isBot && id.startsWith('BOT_'))) {
        throw new Error('FRESH_SEASON_ONE_PARTICIPANT_IDENTITY_INVALID');
      }
      if (!isBot) {
        const account = input.profiles.get(id);
        if (!account || String(account.id || '') !== id || !Array.isArray(account.ownedPlayers)) {
          throw new Error('FRESH_SEASON_ONE_HUMAN_ACCOUNT_PROFILE_MISSING');
        }
      }
      ranks.add(rank);
      usedIds.add(id);
      teamBySlot.set(`${level}:${group}:${rank}`, {
        id,
        name: String(row.name || row.clubName || id),
        isBot,
        level,
        group,
        rank,
      });
    }
    if (ranks.size !== 8) throw new Error('FRESH_SEASON_ONE_GROUP_RANKS_INVALID');
  }
  if (tableByCoordinate.size !== 15 || teamBySlot.size !== 120) {
    throw new Error('FRESH_SEASON_ONE_PARTICIPANT_COUNT_INVALID');
  }

  const slotByCoordinate = new Map<string, SourceDoc>();
  for (const slot of input.slots) {
    const data = slot.data || {};
    const level = Number(data.division || data.level);
    const group = Number(data.group);
    const rank = Number(data.rank);
    const ids = coordinates(level, group, rank);
    const key = `${level}:${group}:${rank}`;
    const team = teamBySlot.get(key);
    if (slot.id !== ids.slotId || Number(data.season) !== 1 ||
        String(data.leagueId || '') !== 'ALPHA' || !team || slotByCoordinate.has(key)) {
      throw new Error('FRESH_SEASON_ONE_SLOT_COORDINATES_INVALID');
    }
    const status = String(data.status || '').toUpperCase();
    const occupantId = String(data.occupantId || '');
    if ((team.isBot && (status !== 'FREE' || occupantId)) ||
        (!team.isBot && (status !== 'OCCUPIED' || occupantId !== team.id))) {
      throw new Error('FRESH_SEASON_ONE_SLOT_PARTICIPANT_MISMATCH');
    }
    slotByCoordinate.set(key, slot);
  }
  if (slotByCoordinate.size !== 120) throw new Error('FRESH_SEASON_ONE_SLOT_COUNT_INVALID');

  const freshTables = [...tableByCoordinate.values()].map(table => {
    const data = table.data || {};
    const level = Number(data.level);
    const group = Number(data.group);
    const stats: Record<string, any> = {};
    for (let rank = 1; rank <= 8; rank++) {
      const team = teamBySlot.get(`${level}:${group}:${rank}`)!;
      stats[team.id] = {
        id: team.id,
        name: team.isBot ? team.name : getFreshSeasonOneClubName(team.id),
        rank,
        matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0,
        isBot: team.isBot,
      };
    }
    return {
      id: table.id,
      data: {
        id: table.id,
        leagueId: 'ALPHA',
        level,
        group,
        season: 1,
        stats,
        version: 140,
        scheduleRevision: 0,
      },
    };
  });

  const freshSlots = [...slotByCoordinate.entries()].map(([key]) => {
    const [level, group, rank] = key.split(':').map(Number);
    const team = teamBySlot.get(key)!;
    return {
      id: coordinates(level, group, rank).slotId,
      data: {
        season: 1, leagueId: 'ALPHA', division: level, group, rank,
        status: team.isBot ? 'FREE' : 'OCCUPIED',
        occupantId: team.isBot ? null : team.id,
        occupancyGeneration: 0,
      },
    };
  });

  const freshProfiles: FreshProfile[] = [];
  for (const team of teamBySlot.values()) {
    const id = team.isBot ? `BOT_ALPHA_L${team.level}_G${team.group}_R${team.rank}` : team.id;
    const data = team.isBot
      ? buildBotClub(id, team.name)
      : createFreshSeasonOneHumanClubProfile(input.profiles.get(id)!, {
          tier: team.level, group: team.group, rank: team.rank,
        }, 1, now);
    freshProfiles.push({ id, data });
  }

  return {
    tables: freshTables,
    slots: freshSlots,
    profiles: freshProfiles,
    counts: {
      tables: freshTables.length,
      slots: freshSlots.length,
      profiles: freshProfiles.length,
      humanClubs: freshProfiles.filter(profile => !profile.id.startsWith('BOT_')).length,
      botClubs: freshProfiles.filter(profile => profile.id.startsWith('BOT_')).length,
      freeRegistrationSlots: freshSlots.filter(slot => slot.data.status === 'FREE').length,
    },
  };
}
