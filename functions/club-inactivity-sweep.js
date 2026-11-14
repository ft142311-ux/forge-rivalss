'use strict';

const { resolveClubInactivity } = require('./club-inactivity-policy');
const { timestampToMillis } = require('./registration-core');

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
  const status = String(match && match.status || '').toLowerCase();
  return Boolean(match && match.isFinished === true) || status === 'finished' || status === 'completed';
}

/**
 * Replaces one inactive human club with its deterministic bot identity.
 * Auth is disabled before the transaction, and all Firestore mutations are
 * committed atomically. A retry can safely finish a previously interrupted
 * retirement because disabled Auth users remain visible to listUsers().
 */
async function retireInactiveClub({ db, auth, userRecord, now = new Date() }) {
  const uid = userRecord && userRecord.uid;
  if (!uid || !userRecord || !userRecord.metadata) return { action: 'SKIPPED_INVALID_AUTH_RECORD' };

  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const pendingSnap = await pendingRef.get();
  // Refresh Auth metadata immediately before making the eligibility decision.
  const latestAuthRecord = await auth.getUser(uid);
  if (latestAuthRecord.disabled && !pendingSnap.exists) {
    return { action: 'SKIPPED_PREVIOUSLY_DISABLED' };
  }
  const activityRef = db.collection('user_activity_v1').doc(uid);
  const activitySnap = await activityRef.get();
  const eligibility = resolveClubInactivity(
    latestAuthRecord.metadata && latestAuthRecord.metadata.lastSignInTime,
    now.getTime(),
    undefined,
    activitySnap.exists ? activitySnap.get('lastActiveAt') : null
  );
  if (!eligibility.eligible) {
    // Recover the crash window where a prior pass disabled Auth and then
    // stopped before the post-disable activity check. Recent verified activity
    // cancels that pending retirement and restores sign-in access.
    if (pendingSnap.exists) {
      if (latestAuthRecord.disabled) await auth.updateUser(uid, { disabled: false });
      await pendingRef.delete().catch(() => undefined);
      return { action: 'CANCELLED_PENDING_RETIREMENT', reason: eligibility.reason };
    }
    return { action: 'SKIPPED_NOT_INACTIVE', reason: eligibility.reason };
  }

  const playerRef = db.collection('players_v14').doc(uid);
  const playerSnap = await playerRef.get();
  if (!playerSnap.exists) return { action: 'SKIPPED_NO_ACTIVE_CLUB' };
  const player = playerSnap.data() || {};

  // The active season config and league slot are authoritative. A stale
  // lastProcessedSeason field must never make retirement target an archived slot.
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await configRef.get();
  if (!configSnap.exists) return { action: 'SKIPPED_SEASON_CONFIG_MISSING' };
  const config = configSnap.data() || {};
  const season = Number(config.activeSeasonNumber);
  if (!Number.isSafeInteger(season) || season < 1 || config.worldReady !== true ||
      !['REGULAR_SEASON', 'ACTIVE'].includes(String(config.phase || ''))) {
    return { action: 'SKIPPED_SEASON_NOT_ACTIVE' };
  }

  const slotQuery = db.collection('league_slots_v1')
    .where('season', '==', season)
    .where('occupantId', '==', uid);
  const preflightSlots = await slotQuery.get();
  if (preflightSlots.size !== 1) return { action: 'SKIPPED_NO_UNIQUE_ACTIVE_SLOT' };
  const expectedSlotId = preflightSlots.docs[0].id;
  const preflightSlot = preflightSlots.docs[0].data() || {};
  const division = Number(preflightSlot.division);
  const group = Number(preflightSlot.group);
  const rank = Number(preflightSlot.rank);

  if (preflightSlot.status !== 'OCCUPIED' || preflightSlot.occupantId !== uid ||
      !Number.isInteger(division) || division < 1 || division > 4 ||
      !Number.isInteger(group) || group < 1 || group > Math.pow(2, division - 1) ||
      !Number.isInteger(rank) || rank < 1 || rank > 8 ||
      player.selectedLeagueId !== LEAGUE_ID ||
      Number(player.leagueLevel) !== division ||
      Number(player.groupId) !== group ||
      Number(player.rank) !== rank) {
    return { action: 'SKIPPED_INVALID_CLUB_COORDINATES' };
  }

  // Disable sign-in and revoke refresh tokens before retiring the club. If the
  // process stops here, the next scheduled pass resumes for this disabled UID.
  if (!pendingSnap.exists) {
    await pendingRef.create({
      uid,
      phase: 'PENDING_AUTH_DISABLE',
      lastSignInAt: eligibility.inactiveSince,
      requestedAt: now,
      season,
      division,
      group,
      rank,
    });
  }
  if (!latestAuthRecord.disabled) await auth.updateUser(uid, { disabled: true });
  await auth.revokeRefreshTokens(uid);

  // Close the race where a successful sign-in lands between the metadata read
  // and Auth disable. If its timestamp advanced, restore access and do not retire.
  const postDisableAuthRecord = await auth.getUser(uid);
  const postDisableActivitySnap = await activityRef.get();
  const postDisableEligibility = resolveClubInactivity(
    postDisableAuthRecord.metadata && postDisableAuthRecord.metadata.lastSignInTime,
    now.getTime(),
    undefined,
    postDisableActivitySnap.exists ? postDisableActivitySnap.get('lastActiveAt') : null
  );
  if (!postDisableEligibility.eligible) {
    await auth.updateUser(uid, { disabled: false });
    await pendingRef.delete().catch(() => undefined);
    return { action: 'SKIPPED_ACTIVITY_RACE', reason: postDisableEligibility.reason };
  }

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
    const [freshPlayer, slots, table, bot, archive, matches, pending, latestActivity, activeConfig] = await Promise.all([
      transaction.get(playerRef),
      transaction.get(slotQuery),
      transaction.get(tableRef),
      transaction.get(botRef),
      transaction.get(archiveRef),
      transaction.get(matchesQuery),
      transaction.get(pendingRef),
      transaction.get(activityRef),
      transaction.get(configRef),
    ]);

    if (archive.exists && !freshPlayer.exists) {
      if (pending.exists) transaction.delete(pendingRef);
      return { action: 'ALREADY_RETIRED', botId };
    }
    if (archive.exists && freshPlayer.exists) {
      return { action: 'BLOCKED_ARCHIVE_COLLISION' };
    }
    if (!pending.exists) return { action: 'BLOCKED_RETIREMENT_MARKER_MISSING' };

    const currentConfig = activeConfig.exists ? activeConfig.data() || {} : {};
    if (!activeConfig.exists ||
        Number(currentConfig.activeSeasonNumber) !== season ||
        currentConfig.worldReady !== true ||
        !['REGULAR_SEASON', 'ACTIVE'].includes(String(currentConfig.phase || ''))) {
      return { action: 'BLOCKED_SEASON_CHANGED' };
    }

    // Re-check activity inside the same transaction that changes the slot.
    // A concurrent verified session write conflicts with this read and forces
    // Firestore to retry the transaction with the newer activity timestamp.
    const transactionEligibility = resolveClubInactivity(
      postDisableAuthRecord.metadata && postDisableAuthRecord.metadata.lastSignInTime,
      now.getTime(),
      undefined,
      latestActivity.exists ? latestActivity.get('lastActiveAt') : null
    );
    if (!transactionEligibility.eligible) {
      return { action: 'SKIPPED_ACTIVITY_RACE', reason: transactionEligibility.reason };
    }

    if (!freshPlayer.exists || slots.size !== 1 || !table.exists || matches.size !== 56) {
      return { action: 'BLOCKED_INTEGRITY_CHECK', reason: 'CLUB_SLOT_TABLE_OR_FIXTURES_MISMATCH' };
    }

    const fresh = freshPlayer.data() || {};
    const slotDoc = slots.docs[0];
    const slot = slotDoc.data() || {};
    if (slotDoc.id !== expectedSlotId) return { action: 'BLOCKED_OWNERSHIP_CHANGED' };
    const tableData = table.data() || {};
    const stats = tableData.stats && typeof tableData.stats === 'object' ? tableData.stats : {};
    if (fresh.selectedLeagueId !== LEAGUE_ID ||
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
      if (isFinished(match)) continue;

      // Only a match involving this retiring club can delay its ownership
      // transition. Other teams' due fixtures must not block this slot.
      if (match.homeId !== uid && match.awayId !== uid) continue;

      const status = String(match.status || '').toLowerCase();
      if (match.isProcessing === true ||
          ['in_progress', 'in-progress', 'processing', 'resolving'].includes(status)) {
        return { action: 'DEFERRED_MATCH_PROCESSING', matchId: matchDoc.id };
      }
      const startValue = match.startTime ?? match.scheduledStartAt;
      const startMs = timestampToMillis(startValue);
      if (startValue == null || !Number.isFinite(startMs)) {
        return { action: 'DEFERRED_MATCH_TIME_UNKNOWN', matchId: matchDoc.id };
      }
      if (startMs <= now.getTime()) {
        return { action: 'DEFERRED_MATCH_ALREADY_DUE', matchId: matchDoc.id };
      }
    }

    const existingBot = bot.exists ? bot.data() || {} : null;
    if (existingBot && (
      existingBot.isBot !== true ||
      !Array.isArray(existingBot.ownedPlayers) ||
      existingBot.ownedPlayers.length !== 5
    )) {
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

    // A bot is the temporary table/fixture participant for an available
    // place. The canonical slot remains claimable by the next new user.
    transaction.update(slotDoc.ref, {
      status: 'FREE',
      occupantId: null,
      occupancyGeneration: Math.max(0, Number(slot.occupancyGeneration) || 0) + 1,
      lastOccupantId: uid,
      lastTransitionReason: 'INACTIVITY_RETIREMENT',
      lastTransitionAt: now,
      replacedAt: now,
      updatedAt: now,
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
        patch.homeLogo = null;
      }
      if (match.awayId === uid) {
        patch.awayId = botId;
        patch.awayName = botName;
        patch.awayLogo = null;
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
    transaction.delete(pendingRef);

    return { action: 'RETIRED_AND_REPLACED', botId, season, division, group, rank };
  });

  if (!['RETIRED_AND_REPLACED', 'ALREADY_RETIRED'].includes(result.action)) {
    // Business/integrity conflicts must not lock a manager out. Remove the
    // pending marker and restore sign-in; a later daily pass can re-evaluate.
    await auth.updateUser(uid, { disabled: false }).catch(() => undefined);
    await pendingRef.delete().catch(() => undefined);
  }
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
