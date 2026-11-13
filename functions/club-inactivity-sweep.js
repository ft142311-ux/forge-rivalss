'use strict';

const { resolveClubInactivity } = require('./club-inactivity-policy');

const LEAGUE_ID = 'ALPHA';
const BATCH_SIZE = 1000;

function botIdFor(slot) {
  return `BOT_${LEAGUE_ID}_L${Number(slot.division)}_G${Number(slot.group)}_R${Number(slot.rank)}`;
}

function botNameFor(slot) {
  return `Bot01${Number(slot.division)}${String(slot.group).padStart(3, '0')}${String(slot.rank).padStart(2, '0')}`;
}

function stableBotOvr(botId, role) {
  let hash = 2166136261;
  const seed = `${botId}|${role}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 23 + (Math.abs(hash) % 5);
}

function buildBotClub(botId, name) {
  const roles = [
    ['Carry', 'carry'], ['Midlaner', 'mid'], ['Tank', 'offlane'],
    ['Jungler', 'support'], ['Support', 'full_support'],
  ];
  const ownedPlayers = roles.map(([role]) => {
    const ovr = stableBotOvr(botId, role);
    const stats = {
      lastHitting: ovr, positioning: ovr, reflexes: ovr,
      versatility: ovr, mapAwareness: ovr, tiltResistance: ovr,
      ganking: ovr, objectiveControl: ovr, communication: ovr,
      manaManagement: ovr,
    };
    return {
      id: `${botId}_${role.toLowerCase()}`, name: `${role} ${botId.slice(-5)}`,
      role, overallRating: ovr, ovr, proStats: stats, form: 100,
      fatigue: 100, salary: 100 + ovr * 5, isBot: true,
    };
  });
  const lineup = {};
  roles.forEach(([role, key], index) => {
    const id = ownedPlayers[index].id;
    lineup[key] = id;
    if (role === 'Tank') lineup.tank = id;
    if (role === 'Jungler') lineup.jungler = id;
    if (role === 'Support') lineup.fullSupport = id;
  });
  return { id: botId, clubName: name, name, isBot: true, ownedPlayers, lineup, botRosterVersion: 2, credits: 0 };
}

function isFinished(match) {
  return match.isFinished === true || String(match.status || '').toLowerCase() === 'finished';
}

/**
 * Replaces one inactive human club with its deterministic bot identity.
 * Auth is disabled before the transaction, and all Firestore mutations are
 * committed atomically. A retry can safely finish a previously interrupted
 * retirement because disabled Auth users remain visible to listUsers().
 */
async function retireInactiveClub({ db, auth, userRecord, now = new Date() }) {
  const uid = userRecord && userRecord.uid;
  if (!uid || !userRecord.metadata || userRecord.disabled) {
    // Disabled users are intentionally still eligible for retry; callers pass
    // their record through the same flow below.
    if (!uid || !userRecord || !userRecord.metadata) return { action: 'SKIPPED_INVALID_AUTH_RECORD' };
  }

  const eligibility = resolveClubInactivity(userRecord.metadata.lastSignInTime, now.getTime());
  if (!eligibility.eligible) return { action: 'SKIPPED_NOT_INACTIVE', reason: eligibility.reason };

  const playerRef = db.collection('players_v14').doc(uid);
  const playerSnap = await playerRef.get();
  if (!playerSnap.exists) return { action: 'SKIPPED_NO_ACTIVE_CLUB' };
  const player = playerSnap.data() || {};

  const season = Number(player.lastProcessedSeason || player.activeSeasonNumber || 0);
  const division = Number(player.leagueLevel);
  const group = Number(player.groupId);
  const rank = Number(player.rank);
  if (!Number.isSafeInteger(season) || season < 1 ||
      !Number.isInteger(division) || division < 1 || division > 4 ||
      !Number.isInteger(group) || group < 1 || group > Math.pow(2, division - 1) ||
      !Number.isInteger(rank) || rank < 1 || rank > 8 ||
      player.selectedLeagueId !== LEAGUE_ID) {
    return { action: 'SKIPPED_INVALID_CLUB_COORDINATES' };
  }

  // Disable sign-in and revoke refresh tokens before retiring the club. If the
  // process stops here, the next scheduled pass resumes for this disabled UID.
  if (!userRecord.disabled) {
    await auth.updateUser(uid, { disabled: true });
  }
  await auth.revokeRefreshTokens(uid);

  const slotQuery = db.collection('league_slots_v1')
    .where('season', '==', season)
    .where('occupantId', '==', uid);
  const tableRef = db.collection('league_tables_v2')
    .doc(`table_v140_S${season}_L${LEAGUE_ID}_V${division}_G${group}`);
  const botId = `BOT_${LEAGUE_ID}_L${division}_G${group}_R${rank}`;
  const botRef = db.collection('players_v14').doc(botId);
  const archiveRef = db.collection('inactive_clubs_v1').doc(uid);
  const matchesQuery = db.collection('matches_v2')
    .where('season', '==', season)
    .where('leagueId', '==', LEAGUE_ID)
    .where('level', '==', division)
    .where('groupId', '==', group)
    .where('version', '==', 140);

  const result = await db.runTransaction(async (transaction) => {
    const [freshPlayer, slots, table, bot, archive, matches] = await Promise.all([
      transaction.get(playerRef),
      transaction.get(slotQuery),
      transaction.get(tableRef),
      transaction.get(botRef),
      transaction.get(archiveRef),
      transaction.get(matchesQuery),
    ]);

    if (archive.exists && !freshPlayer.exists) {
      return { action: 'ALREADY_RETIRED', botId };
    }
    if (!freshPlayer.exists || slots.size !== 1 || !table.exists || matches.size !== 56) {
      return { action: 'BLOCKED_INTEGRITY_CHECK', reason: 'CLUB_SLOT_TABLE_OR_FIXTURES_MISMATCH' };
    }

    const fresh = freshPlayer.data() || {};
    const slotDoc = slots.docs[0];
    const slot = slotDoc.data() || {};
    const tableData = table.data() || {};
    const stats = tableData.stats && typeof tableData.stats === 'object' ? tableData.stats : {};
    if (fresh.selectedLeagueId !== LEAGUE_ID ||
        Number(fresh.lastProcessedSeason || fresh.activeSeasonNumber || 0) !== season ||
        Number(fresh.leagueLevel) !== division || Number(fresh.groupId) !== group || Number(fresh.rank) !== rank ||
        slot.status !== 'OCCUPIED' || slot.occupantId !== uid ||
        Number(slot.division) !== division || Number(slot.group) !== group || Number(slot.rank) !== rank ||
        Number(tableData.season) !== season || Number(tableData.level) !== division || Number(tableData.group) !== group) {
      return { action: 'BLOCKED_OWNERSHIP_CHANGED' };
    }

    const userRows = Object.entries(stats).filter(([key, row]) =>
      key === uid || String(row && row.id) === uid
    );
    const rowsAtRank = Object.entries(stats).filter(([, row]) => Number(row && row.rank) === rank);
    if (userRows.length !== 1 || rowsAtRank.length !== 1 || rowsAtRank[0][0] !== userRows[0][0]) {
      return { action: 'BLOCKED_TABLE_IDENTITY_CONFLICT' };
    }

    for (const matchDoc of matches.docs) {
      const match = matchDoc.data() || {};
      if (!isFinished(match) && match.isProcessing === true) {
        return { action: 'DEFERRED_MATCH_PROCESSING', matchId: matchDoc.id };
      }
    }

    const existingBot = bot.exists ? bot.data() || {} : null;
    if (existingBot && existingBot.isBot !== true) {
      return { action: 'BLOCKED_BOT_ID_COLLISION' };
    }

    const botName = botNameFor(slot);
    const nextStats = { ...stats };
    const oldRow = nextStats[userRows[0][0]] || {};
    delete nextStats[userRows[0][0]];
    nextStats[botId] = {
      ...oldRow,
      id: botId,
      name: botName,
      rank,
      isBot: true,
    };

    transaction.update(slotDoc.ref, {
      status: 'OCCUPIED',
      occupantId: botId,
      replacedAt: new Date(),
      updatedAt: new Date(),
    });
    transaction.update(tableRef, { stats: nextStats, updatedAt: new Date() });
    if (!bot.exists) transaction.create(botRef, buildBotClub(botId, botName));

    for (const matchDoc of matches.docs) {
      const match = matchDoc.data() || {};
      if (isFinished(match)) continue; // Preserve every completed result byte-for-byte.
      const patch = {};
      if (match.homeId === uid) {
        patch.homeId = botId;
        patch.homeName = botName;
      }
      if (match.awayId === uid) {
        patch.awayId = botId;
        patch.awayName = botName;
      }
      if (Object.keys(patch).length) transaction.update(matchDoc.ref, patch);
    }

    transaction.create(archiveRef, {
      uid,
      clubSnapshot: fresh,
      replacedByBotId: botId,
      season,
      leagueId: LEAGUE_ID,
      division,
      group,
      rank,
      reason: 'INACTIVE_OVER_90_DAYS',
      lastSignInAt: eligibility.inactiveSince,
      retiredAt: now,
      createdAt: now,
    });
    transaction.delete(playerRef);

    return { action: 'RETIRED_AND_REPLACED', botId, season, division, group, rank };
  });

  return result;
}

async function runClubInactivitySweep({ db, auth, now = new Date(), pageSize = BATCH_SIZE }) {
  const summary = { scannedAuthUsers: 0, inactiveCandidates: 0, retired: 0, deferred: 0, skipped: 0, errors: [] };
  let pageToken;
  do {
    const page = await auth.listUsers(pageSize, pageToken);
    for (const userRecord of page.users) {
      summary.scannedAuthUsers++;
      const eligibility = resolveClubInactivity(userRecord.metadata && userRecord.metadata.lastSignInTime, now.getTime());
      if (!eligibility.eligible) continue;
      summary.inactiveCandidates++;
      try {
        const result = await retireInactiveClub({ db, auth, userRecord, now });
        if (result.action === 'RETIRED_AND_REPLACED' || result.action === 'ALREADY_RETIRED') summary.retired++;
        else if (result.action.startsWith('DEFERRED')) summary.deferred++;
        else summary.skipped++;
      } catch (error) {
        summary.errors.push({ uid: userRecord.uid, code: String(error && (error.code || error.message) || 'UNKNOWN').slice(0, 120) });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return summary;
}

module.exports = { buildBotClub, botIdFor, isFinished, retireInactiveClub, runClubInactivitySweep };
