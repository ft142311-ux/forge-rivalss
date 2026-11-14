'use strict';

const { resolveClubInactivity } = require('./club-inactivity-policy');
const { timestampToMillis } = require('./registration-core');
const { randomUUID } = require('node:crypto');

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

function isValidBotClub(bot, botId) {
  if (!bot || bot.isBot !== true || bot.id !== botId ||
      !Array.isArray(bot.ownedPlayers) || bot.ownedPlayers.length !== 5 ||
      !bot.lineup || typeof bot.lineup !== 'object') return false;

  const playerIds = new Set();
  for (const player of bot.ownedPlayers) {
    if (!player || typeof player.id !== 'string' || !player.id ||
        player.isBot !== true ||
        !Number.isFinite(Number(player.overallRating)) ||
        Number(player.overallRating) < 1 || Number(player.overallRating) > 100 ||
        !player.proStats || typeof player.proStats !== 'object') return false;
    if (playerIds.has(player.id)) return false;
    playerIds.add(player.id);
  }

  const requiredLineupKeys = ['carry', 'mid', 'offlane', 'support', 'full_support'];
  return requiredLineupKeys.every((key) =>
    typeof bot.lineup[key] === 'string' && playerIds.has(bot.lineup[key])
  );
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
  if (pendingSnap.exists && pendingSnap.get('phase') === 'REVIEW_REQUIRED') {
    return { action: 'SKIPPED_REVIEW_REQUIRED' };
  }
  // Refresh Auth metadata immediately before making the eligibility decision.
  const latestAuthRecord = await auth.getUser(uid);
  if (pendingSnap.exists && pendingSnap.get('phase') === 'CANCELLED') {
    if (latestAuthRecord.disabled) await auth.updateUser(uid, { disabled: false });
    await pendingRef.delete().catch(() => undefined);
    return { action: 'CANCELLED_PENDING_CLEANUP' };
  }
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
    // Once a retirement marker exists, it is a committed account fence.
    // Never let a second worker cancel or delete another worker's operation.
    // The transactional claim below prevents fresh activity from creating a
    // new marker in the first place; legacy/conflicting markers fail closed.
    if (pendingSnap.exists) {
      await db.runTransaction(async (transaction) => {
        const pending = await transaction.get(pendingRef);
        if (pending.exists && pending.get('phase') === 'PENDING_AUTH_DISABLE') {
          transaction.update(pendingRef, {
            phase: 'REVIEW_REQUIRED',
            lastErrorCode: 'PENDING_RETIREMENT_ACTIVITY_CONFLICT',
            reviewRequiredAt: now,
            updatedAt: now,
          });
        }
      });
      return { action: 'BLOCKED_PENDING_RETIREMENT_ACTIVITY_CONFLICT', reason: eligibility.reason };
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
  const expectedGeneration = Math.max(0, Number(preflightSlot.occupancyGeneration) || 0);
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

  // The durable pending marker is also a lease. Only one worker may advance
  // it at a time; an expired lease is reclaimable after a crash or timeout.
  // The login handshake reads the same marker in its activity transaction.
  const leaseOwner = `inactivity-${process.pid || 'worker'}-${randomUUID()}`;
  const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000);
  const claim = await db.runTransaction(async (transaction) => {
    const [pending, latestActivity] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(activityRef),
    ]);
    if (pending.exists) {
      const pendingPhase = String(pending.get('phase') || '');
      if (pendingPhase === 'CANCELLED') {
        return { claimed: false, cancelled: true };
      }
      if (pendingPhase === 'REVIEW_REQUIRED') {
        return { claimed: false, reviewRequired: true };
      }
      if (pendingPhase !== 'PENDING_AUTH_DISABLE') {
        transaction.update(pendingRef, {
          phase: 'REVIEW_REQUIRED',
          lastErrorCode: 'UNKNOWN_RETIREMENT_PHASE',
          reviewRequiredAt: now,
          updatedAt: now,
        });
        return { claimed: false, reviewRequired: true };
      }
      const currentLeaseUntil = timestampToMillis(pending.get('leaseUntil'));
      if (Number.isFinite(currentLeaseUntil) && currentLeaseUntil > now.getTime()) {
        return { claimed: false, busy: true };
      }
      transaction.update(pendingRef, {
        leaseOwner,
        leaseUntil,
        attempts: Number(pending.get('attempts') || 0) + 1,
        updatedAt: now,
      });
      return { claimed: true, resumed: true };
    }

    const claimEligibility = resolveClubInactivity(
      latestAuthRecord.metadata && latestAuthRecord.metadata.lastSignInTime,
      now.getTime(),
      undefined,
      latestActivity.exists ? latestActivity.get('lastActiveAt') : null,
    );
    if (!claimEligibility.eligible) {
      return { claimed: false, reason: claimEligibility.reason };
    }

    transaction.create(pendingRef, {
      uid,
      phase: 'PENDING_AUTH_DISABLE',
      lastSignInAt: latestAuthRecord.metadata && latestAuthRecord.metadata.lastSignInTime || null,
      inactiveSince: claimEligibility.inactiveSince || eligibility.inactiveSince,
      requestedAt: now,
      season,
      division,
      group,
      rank,
      expectedSlotId,
      expectedGeneration,
      leaseOwner,
      leaseUntil,
      attempts: 1,
    });
    return { claimed: true, resumed: false };
  });

  if (claim.reviewRequired) return { action: 'SKIPPED_REVIEW_REQUIRED' };
  if (claim.busy) return { action: 'SKIPPED_RETIREMENT_IN_PROGRESS' };
  if (claim.cancelled) {
    if (latestAuthRecord.disabled) await auth.updateUser(uid, { disabled: false });
    await db.runTransaction(async (transaction) => {
      const pending = await transaction.get(pendingRef);
      if (pending.exists && pending.get('phase') === 'CANCELLED') {
        transaction.delete(pendingRef);
      }
    });
    return { action: 'CANCELLED_PENDING_CLEANUP' };
  }
  if (!claim.claimed) {
    return { action: 'SKIPPED_ACTIVITY_RACE', reason: claim.reason || 'RECENT_ACTIVITY' };
  }

  // Auth and Firestore cannot share a transaction. Re-read Auth metadata after
  // claiming the Firestore fence so a sign-in that completed just before the
  // claim is not accidentally retired using the earlier Auth snapshot.
  const claimAuthRecord = await auth.getUser(uid);
  const claimActivitySnap = await activityRef.get();
  const claimEligibility = resolveClubInactivity(
    claimAuthRecord.metadata && claimAuthRecord.metadata.lastSignInTime,
    now.getTime(),
    undefined,
    claimActivitySnap.exists ? claimActivitySnap.get('lastActiveAt') : null,
  );
  if (!claimEligibility.eligible) {
    const markedCancelled = await db.runTransaction(async (transaction) => {
      const pending = await transaction.get(pendingRef);
      if (!pending.exists || pending.get('leaseOwner') !== leaseOwner ||
          pending.get('phase') !== 'PENDING_AUTH_DISABLE') return false;
      transaction.update(pendingRef, {
        phase: 'CANCELLED',
        cancellationReason: 'RECENT_ACTIVITY_AFTER_CLAIM',
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      });
      return true;
    });
    if (markedCancelled) {
      if (claimAuthRecord.disabled) await auth.updateUser(uid, { disabled: false });
      await db.runTransaction(async (transaction) => {
        const pending = await transaction.get(pendingRef);
        if (pending.exists && pending.get('phase') === 'CANCELLED') {
          transaction.delete(pendingRef);
        }
      });
    }
    return { action: 'SKIPPED_ACTIVITY_RACE', reason: claimEligibility.reason };
  }

  if (!claimAuthRecord.disabled) await auth.updateUser(uid, { disabled: true });
  await auth.revokeRefreshTokens(uid);

  const postDisableAuthRecord = await auth.getUser(uid);
  if (!postDisableAuthRecord.disabled) {
    throw new Error('AUTH_ACCOUNT_DISABLE_NOT_CONFIRMED');
  }

  const tableRef = db.collection('league_tables_v2')
    .doc(`table_v140_S${season}_L${LEAGUE_ID}_V${division}_G${group}`);
  const botId = `BOT_${LEAGUE_ID}_L${division}_G${group}_R${rank}`;
  const targetGeneration = expectedGeneration + 1;
  const historyRef = db.collection('league_slot_history_v1')
    .doc(`${expectedSlotId}_G${targetGeneration}`);
  const botRef = db.collection('players_v14').doc(botId);
  const archiveRef = db.collection('inactive_clubs_v1').doc(uid);
  const matchesQuery = db.collection('matches_v2')
    .where('season', '==', season)
    .where('leagueId', '==', LEAGUE_ID)
    .where('level', '==', division)
    .where('groupId', '==', group)
    .where('version', '==', 140);

  const result = await db.runTransaction(async (transaction) => {
    const [freshPlayer, slots, table, bot, archive, matches, pending, latestActivity, activeConfig, history] = await Promise.all([
      transaction.get(playerRef),
      transaction.get(slotQuery),
      transaction.get(tableRef),
      transaction.get(botRef),
      transaction.get(archiveRef),
      transaction.get(matchesQuery),
      transaction.get(pendingRef),
      transaction.get(activityRef),
      transaction.get(configRef),
      transaction.get(historyRef),
    ]);

    if (archive.exists && !freshPlayer.exists) {
      if (pending.exists) transaction.delete(pendingRef);
      return { action: 'ALREADY_RETIRED', botId };
    }
    if (archive.exists && freshPlayer.exists) {
      return { action: 'BLOCKED_ARCHIVE_COLLISION' };
    }
    if (!pending.exists) return { action: 'BLOCKED_RETIREMENT_MARKER_MISSING' };
    if (pending.get('leaseOwner') !== leaseOwner) return { action: 'BLOCKED_STALE_RETIREMENT_WORKER' };
    if (pending.get('phase') !== 'PENDING_AUTH_DISABLE') {
      return { action: 'BLOCKED_RETIREMENT_PHASE_INVALID' };
    }
    const currentLeaseUntil = timestampToMillis(pending.get('leaseUntil'));
    if (!Number.isFinite(currentLeaseUntil) || currentLeaseUntil <= now.getTime()) {
      return { action: 'BLOCKED_STALE_RETIREMENT_WORKER' };
    }
    if (history.exists) return { action: 'BLOCKED_HISTORY_EVENT_COLLISION' };

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
    if (slotDoc.id !== expectedSlotId ||
        Math.max(0, Number(slot.occupancyGeneration) || 0) !== expectedGeneration) {
      return { action: 'BLOCKED_OWNERSHIP_CHANGED' };
    }
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
      if (match.isProcessing === true || match.startedAt || match.processingStartedAt ||
          ['in_progress', 'in-progress', 'processing', 'resolving', 'running', 'live'].includes(status)) {
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
    if (existingBot && !isValidBotClub(existingBot, botId)) {
      return { action: 'BLOCKED_BOT_ID_COLLISION' };
    }
    if (Object.prototype.hasOwnProperty.call(stats, botId)) {
      return { action: 'BLOCKED_TABLE_IDENTITY_CONFLICT' };
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
      occupancyGeneration: targetGeneration,
      lastOccupantId: uid,
      lastTransitionReason: 'INACTIVITY_RETIREMENT',
      lastTransitionAt: now,
      replacedAt: now,
      updatedAt: now,
    });
    transaction.create(historyRef, {
      slotId: slotDoc.id,
      season,
      leagueId: LEAGUE_ID,
      division,
      group,
      rank,
      previousGeneration: expectedGeneration,
      generation: targetGeneration,
      previousOccupantType: 'USER',
      previousOccupantId: uid,
      previousOwnerUid: uid,
      previousClubId: uid,
      newOccupantType: 'BOT',
      newOccupantId: botId,
      newOwnerUid: null,
      newClubId: botId,
      reason: 'INACTIVITY_RETIREMENT',
      operationId: pendingRef.id,
      createdAt: now,
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
      lastSignInAt: latestAuthRecord.metadata && latestAuthRecord.metadata.lastSignInTime || null,
      lastActiveAt: eligibility.inactiveSince,
      retiredAt: now,
      createdAt: now,
    });
    transaction.delete(playerRef);
    transaction.delete(pendingRef);

    return { action: 'RETIRED_AND_REPLACED', botId, season, division, group, rank };
  });

  if (result.action === 'BLOCKED_STALE_RETIREMENT_WORKER') {
    return result;
  }

  if ([
    'BLOCKED_ARCHIVE_COLLISION',
    'BLOCKED_HISTORY_EVENT_COLLISION',
    'BLOCKED_OWNERSHIP_CHANGED',
    'BLOCKED_TABLE_IDENTITY_CONFLICT',
    'BLOCKED_BOT_ID_COLLISION',
    'BLOCKED_INTEGRITY_CHECK',
    'BLOCKED_RETIREMENT_PHASE_INVALID',
  ].includes(result.action)) {
    await db.runTransaction(async (transaction) => {
      const pending = await transaction.get(pendingRef);
      if (pending.exists && pending.get('leaseOwner') === leaseOwner) {
        transaction.update(pendingRef, {
          phase: 'REVIEW_REQUIRED',
          lastErrorCode: result.action,
          reviewRequiredAt: now,
          updatedAt: now,
        });
      }
    });
    return result;
  }

  if (!['RETIRED_AND_REPLACED', 'ALREADY_RETIRED'].includes(result.action)) {
    // Only the current lease owner may release the operation or re-enable Auth.
    // A stale worker must never undo a newer worker's progress.
    const markedCancelled = await db.runTransaction(async (transaction) => {
      const pending = await transaction.get(pendingRef);
      if (!pending.exists || pending.get('leaseOwner') !== leaseOwner) return false;
      transaction.update(pendingRef, {
        phase: 'CANCELLED',
        cancellationReason: result.action,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      });
      return true;
    });
    if (markedCancelled) {
      // If Auth re-enable fails or the worker crashes, the CANCELLED marker is
      // recoverable by the next sweep and is ignored by the login fence.
      await auth.updateUser(uid, { disabled: false });
      await db.runTransaction(async (transaction) => {
        const pending = await transaction.get(pendingRef);
        if (pending.exists && pending.get('phase') === 'CANCELLED') {
          transaction.delete(pendingRef);
        }
      });
    }
  }
  return result;
}

async function runClubInactivitySweep({ db, auth, now = new Date(), pageSize = BATCH_SIZE }) {
  const summary = {
    scannedAuthUsers: 0,
    inactiveCandidates: 0,
    retired: 0,
    deferred: 0,
    inProgress: 0,
    recoveredCancellations: 0,
    reviewRequired: 0,
    skipped: 0,
    errors: [],
  };
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
        else if (result.action === 'SKIPPED_RETIREMENT_IN_PROGRESS') summary.inProgress++;
        else if (result.action === 'CANCELLED_PENDING_CLEANUP') summary.recoveredCancellations++;
        else if (result.action === 'SKIPPED_REVIEW_REQUIRED' || result.action.startsWith('BLOCKED_')) summary.reviewRequired++;
        else summary.skipped++;
      } catch (error) {
        summary.errors.push({ uid: userRecord.uid, code: String(error && (error.code || error.message) || 'UNKNOWN').slice(0, 120) });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return summary;
}

module.exports = { buildBotClub, botIdFor, isFinished, isValidBotClub, retireInactiveClub, runClubInactivitySweep };
