
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { MAX_LEVELS, getGroupsCountInLevel, getTableId, getBotId, getBotName } from '@/app/lib/leagues-data';
import { getRandomStartingSquad, Player } from '@/app/lib/moba-data';
import { requireServerActor } from '@/lib/server-auth';


const PLAYER_GAME_YEAR_DAYS = 7;
const PLAYER_GAME_MONTHS = 12;
const PLAYER_GAME_YEAR_MS = PLAYER_GAME_YEAR_DAYS * 24 * 60 * 60 * 1000;
const PLAYER_GAME_MONTH_MS = PLAYER_GAME_YEAR_MS / PLAYER_GAME_MONTHS;

function normalizeStarterAges(players: Player[]): Player[] {
  const now = Date.now();
  return players.map((player, index) => {
    // A fresh registration must never give every starter 18.0.
    // If an older generator produced a uniform 18-year-old squad, repair it once.
    const allLegacy18 = Number(player.age) === 18 && !player.birthDate;
    if (!allLegacy18 && player.birthDate && player.ageDisplay) return player;

    const isYouth = Boolean(player.isYouth);
    const minYears = isYouth ? 14 : 18;
    const maxYears = isYouth ? 16 : 30;
    const years = minYears + ((index * 7 + Math.floor(Math.random() * (maxYears - minYears + 1))) % (maxYears - minYears + 1));
    const month = Math.floor(Math.random() * 13);
    const ageMs = years * PLAYER_GAME_YEAR_MS + month * PLAYER_GAME_MONTH_MS;
    const birthDate = new Date(now - ageMs).toISOString();
    return {
      ...player,
      baseAge: years + month / PLAYER_GAME_MONTHS,
      age: years + month / PLAYER_GAME_MONTHS,
      ageDisplay: `${years}.${month}`,
      birthDate,
      ageSystemVersion: 5,
    };
  });
}

/**
 * @fileOverview Атомарная инициализация клуба.
 * Серверный источник истины для новых игроков.
 */

interface ProvisionResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Генерирует полное начальное состояние клуба.
 */
function createInitialClubState(userId: string, email: string, clubName: string, placement: any, seasonNum: number) {
  const startingSquad = normalizeStarterAges(getRandomStartingSquad());
  
  // Создаем Lineup на основе сгенерированного состава
  const lineup: Record<string, string | null> = {
    carry: startingSquad.find(p => p.role === 'Carry')?.id || null,
    mid: startingSquad.find(p => p.role === 'Midlaner')?.id || null,
    offlane: startingSquad.find(p => p.role === 'Tank')?.id || null,
    support: startingSquad.find(p => p.role === 'Jungler')?.id || null,
    full_support: startingSquad.find(p => p.role === 'Support')?.id || null,
    sub_carry: null, sub_mid: null, sub_offlane: null, sub_support: null, sub_full_support: null,
    res1: null, res2: null, res3: null, res4: null, res5: null, res6: null, res7: null, res8: null
  };

  return {
    id: userId,
    email: email,
    displayName: clubName,
    clubName: clubName,
    country: "International",
    numericId: 0, // Установит транзакция
    
    credits: 1000000,
    crystals: 50,
    experiencePoints: 0,
    managerLevel: 1,
    
    selectedLeagueId: "ALPHA",
    leagueLevel: placement.tier,
    groupId: placement.group,
    rank: placement.rank,
    
    ownedPlayers: startingSquad,
    lineup: lineup,
    
    staff: { coach: null, analyst: null, scout: null, doctor: null, financier: null },
    strategy: "Balanced Play",
    
    arena: { capacity: 5000, pressCenterLevel: 1, cafeLevel: 1, shopLevel: 1 },
    hq: { hrLevel: 1, financeLevel: 1 },
    bootcamp: { bootcampLevel: 1 },
    academy: { scoutsLevel: 1 },
    medical: { massageLevel: 1 },
    
    lastProcessedSeason: seasonNum,
    rewardDay: 1,
    lastLoginDate: new Date().toISOString(),
    version: 140
  };
}

/**
 * Атомарная регистрация клуба.
 */
async function provisionClubComplete(userId: string, email: string, clubName: string): Promise<ProvisionResult> {
  const db = getAdminDb();
  const cleanName = clubName.trim().substring(0, 25);
  
  try {
    return await db.runTransaction(async (transaction) => {
      const playerRef = db.collection('players_v14').doc(userId);
      const playerSnap = await transaction.get(playerRef);

      // 1. Идемпотентность: возвращаем профиль, если он уже создан
      if (playerSnap.exists) {
        return { success: true, data: playerSnap.data() };
      }

      // 2. Получаем текущий сезон
      const configRef = db.collection('system_v1').doc('season_config');
      const configSnap = await transaction.get(configRef);
      const seasonNum = configSnap.exists ? (configSnap.data()?.activeSeasonNumber || 1) : 1;

      // 3. Поиск свободного слота (атомарно)
      let placement = null;
      // Начинаем поиск с Division 4
      for (let tier = MAX_LEVELS; tier >= 1; tier--) {
        const groupsInTier = getGroupsCountInLevel(tier);
        for (let group = 1; group <= groupsInTier; group++) {
          const tableId = getTableId(seasonNum, "ALPHA", tier, group);
          const tableRef = db.collection('league_tables_v2').doc(tableId);
          const tableSnap = await transaction.get(tableRef);
          
          if (!tableSnap.exists) continue; // Группа еще не инициализирована оркестратором

          const stats = tableSnap.data()?.stats || {};
          const botId = Object.keys(stats).find(id => stats[id].isBot);
          
          if (botId) {
            placement = { tier, group, rank: stats[botId].rank, botToReplace: botId, tableRef };
            break;
          }
        }
        if (placement) break;
      }

      if (!placement) return { success: false, error: "NO_FREE_SLOTS" };

      // 4. Создаем состояние клуба
      const initialState = createInitialClubState(userId, email, cleanName, placement, seasonNum);
      
      // 5. Обновляем счетчик игроков
      const statsRef = db.collection('system_v1').doc('global_stats');
      const statsSnap = await transaction.get(statsRef);
      const nextId = (statsSnap.exists ? (statsSnap.data()?.totalPlayers || 1000) : 1000) + 1;
      initialState.numericId = nextId;

      // 6. Обновляем таблицу (заменяем бота на человека)
      const tableData = (await transaction.get(placement.tableRef)).data();
      const newStats = { ...tableData?.stats };
      delete newStats[placement.botToReplace];
      newStats[userId] = {
        id: userId, name: cleanName, rank: placement.rank,
        matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0, isBot: false
      };

      transaction.update(placement.tableRef, { stats: newStats, updatedAt: FieldValue.serverTimestamp() });
      transaction.set(playerRef, { ...initialState, createdAt: FieldValue.serverTimestamp() });
      transaction.set(statsRef, { totalPlayers: nextId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      // 7. Обновляем матчи в этой группе
      const matchesQuery = db.collection('matches_v2')
        .where('season', '==', seasonNum)
        .where('leagueId', '==', 'ALPHA')
        .where('level', '==', placement.tier)
        .where('groupId', '==', placement.group);
      
      const matchesSnap = await transaction.get(matchesQuery);
      matchesSnap.forEach(mDoc => {
        const m = mDoc.data();
        const updates: any = {};
        if (m.homeId === placement.botToReplace) { updates.homeId = userId; updates.homeName = cleanName; }
        if (m.awayId === placement.botToReplace) { updates.awayId = userId; updates.awayName = cleanName; }
        if (Object.keys(updates).length > 0) transaction.update(mDoc.ref, updates);
      });

      return { success: true, data: initialState };
    });
  } catch (e: any) {
    console.error("[PROVISIONING FAILED]:", e);
    return { success: false, error: "REGISTRATION_FAILED" };
  }
}

/**
 * Reverses the current callable registration allocation: the manager is
 * removed, their exact Division 4 slot becomes FREE again, and the bot that
 * occupied that rank is restored in the table and scheduled matches.
 */
export async function releasePlayerSlot(idToken: string) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(userId);

  try {
    return await db.runTransaction(async (transaction) => {
      const playerSnap = await transaction.get(playerRef);
      if (!playerSnap.exists) return { success: true, alreadyReleased: true };

      const player = playerSnap.data()!;
      const season = Number(player.lastProcessedSeason);
      const leagueId = player.selectedLeagueId || 'ALPHA';
      const division = Number(player.leagueLevel);
      const group = Number(player.groupId);
      const rank = Number(player.rank);

      if (!Number.isInteger(season) || !Number.isInteger(division) || !Number.isInteger(group) || !Number.isInteger(rank)) {
        throw new Error('PLAYER_LEAGUE_PLACEMENT_INVALID');
      }

      const slotRef = db.collection('league_slots_v1').doc(`S${season}_L${leagueId}_D${division}_G${group}_R${rank}`);
      const tableRef = db.collection('league_tables_v2').doc(getTableId(season, leagueId, division, group));
      const matchesQuery = db.collection('matches_v2')
        .where('season', '==', season)
        .where('leagueId', '==', leagueId)
        .where('level', '==', division)
        .where('groupId', '==', group);

      const [slotSnap, tableSnap, matchesSnap] = await Promise.all([
        transaction.get(slotRef),
        transaction.get(tableRef),
        transaction.get(matchesQuery)
      ]);

      if (!tableSnap.exists) throw new Error('LEAGUE_TABLE_MISSING');
      if (slotSnap.exists && slotSnap.data()?.occupantId && slotSnap.data()?.occupantId !== userId) {
        throw new Error('LEAGUE_SLOT_OCCUPIED_BY_ANOTHER_PLAYER');
      }
      const table = tableSnap.data()!;
      const botId = getBotId(leagueId, division, group, rank);
      const restoredBot = {
        id: botId,
        name: getBotName(division, group, rank),
        rank,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        diff: 0,
        isBot: true
      };
      const restoredStats = { ...(table.stats || {}) };
      delete restoredStats[userId];
      restoredStats[botId] = restoredBot;

      transaction.set(slotRef, {
        season,
        leagueId,
        division,
        group,
        rank,
        status: 'FREE',
        occupantId: null,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.update(tableRef, { stats: restoredStats, updatedAt: FieldValue.serverTimestamp() });

      matchesSnap.forEach((matchDoc) => {
        const match = matchDoc.data();
        const updates: Record<string, string> = {};
        if (match.homeId === userId) {
          updates.homeId = botId;
          updates.homeName = restoredBot.name;
        }
        if (match.awayId === userId) {
          updates.awayId = botId;
          updates.awayName = restoredBot.name;
        }
        if (Object.keys(updates).length > 0) transaction.update(matchDoc.ref, updates);
      });

      transaction.delete(playerRef);
      return { success: true };
    });
  } catch (error: any) {
    console.error('[RELEASE PLAYER SLOT FAILED]', { code: error?.code, message: error?.message, userId });
    return { success: false, error: 'PROFILE_RESET_FAILED' };
  }
}
