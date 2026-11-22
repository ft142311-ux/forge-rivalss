import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { buildFreshSeasonOneWorldDocuments } from './fresh-season-one-world-builder';
import { ensureSeasonCalendar } from './season-calendar';
import { createOrVerifyDurableSeasonOneArchive } from './staging-season-one-reset-durable-archive';

const JOURNAL_ID = 'staging_fresh_season_one_reset_v1';
const LEASE_MS = 20 * 60 * 1000;
const CUP_ID = 'cup_s1_lALPHA';
const MATCH_PREFIX = 'match_v140_S1_LALPHA_';

type ResetJournal = {
  schemaVersion: 1;
  resetId: string;
  status: 'RUNNING' | 'FAILED' | 'COMPLETED';
  stepIndex: number;
  startedAtMs: number;
  updatedAtMs: number;
  target: { seasonStart: string; nextSeasonStart: string };
  counts: Record<string, number>;
  sourceConfig?: Record<string, any>;
  lease: { token: string; expiresAtMs: number } | null;
  lastError?: string;
};

function errorCode(error: unknown) {
  const message = String((error as any)?.message || error || 'RESET_FAILED');
  return message.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 120);
}

async function claim(db: any, target: ResetJournal['target']) {
  const ref = db.collection('system_v1').doc(JOURNAL_ID);
  const now = Date.now();
  const token = randomUUID();
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const configRef = db.collection('system_v1').doc('season_config');
    const rolloverLockRef = db.collection('system_v1').doc('season_rollover_v1');
    const calendarLockRef = db.collection('system_v1').doc('season_calendar_build_v1');
    const [configSnap, rolloverLockSnap, calendarLockSnap] = await Promise.all([
      tx.get(configRef), tx.get(rolloverLockRef), tx.get(calendarLockRef),
    ]);
    const current = snap.exists ? snap.data() as ResetJournal : null;
    if (current?.status === 'COMPLETED') return { completed: true, journal: current };
    if (current?.lease && Number(current.lease.expiresAtMs) > now) {
      return { busy: true, journal: current };
    }
    const config = configSnap.exists ? configSnap.data() || {} : {};
    if (current && !current.sourceConfig) throw new Error('RESET_ORIGINAL_CONFIG_ARCHIVE_SOURCE_MISSING');
    if (!current && (!configSnap.exists || Number(config.activeSeasonNumber) !== 1 ||
        config.worldReady !== true || !['REGULAR_SEASON', 'ACTIVE'].includes(String(config.phase || '').toUpperCase()))) {
      throw new Error('RESET_PREFLIGHT_STATE_CHANGED');
    }
    if (!current && [rolloverLockSnap, calendarLockSnap].some(lock =>
      lock.exists && Number(lock.data()?.expiresAtMs || 0) > now)) {
      throw new Error('RESET_SEASON_WORKER_LOCKED');
    }
    const journal: ResetJournal = current ? {
      ...current,
      status: 'RUNNING',
      updatedAtMs: now,
      lease: { token, expiresAtMs: now + LEASE_MS },
      lastError: '',
    } : {
      schemaVersion: 1,
      resetId: `fresh-s1-${now}`,
      status: 'RUNNING',
      stepIndex: 0,
      startedAtMs: now,
      updatedAtMs: now,
      target,
      counts: {},
      sourceConfig: config,
      lease: { token, expiresAtMs: now + LEASE_MS },
    };
    if (current && (current.target.seasonStart !== target.seasonStart ||
        current.target.nextSeasonStart !== target.nextSeasonStart)) {
      throw new Error('RESET_TARGET_CHANGED_DURING_RECOVERY');
    }
    tx.set(ref, journal);
    tx.set(configRef, { worldReady: false, stagingSeasonOneResetInProgress: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { acquired: true, token, journal };
  });
}

async function assertLease(db: any, token: string) {
  const ref = db.collection('system_v1').doc(JOURNAL_ID);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() as ResetJournal : null;
    if (!current || current.status !== 'RUNNING' || current.lease?.token !== token ||
        Number(current.lease.expiresAtMs) <= Date.now()) {
      throw new Error('FRESH_SEASON_ONE_RESET_LEASE_LOST');
    }
    tx.set(ref, {
      updatedAtMs: Date.now(),
      lease: { token, expiresAtMs: Date.now() + LEASE_MS },
    }, { merge: true });
  });
}

async function saveStep(db: any, token: string, stepIndex: number, counts?: Record<string, number>) {
  const ref = db.collection('system_v1').doc(JOURNAL_ID);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() as ResetJournal : null;
    if (!current || current.lease?.token !== token || current.stepIndex !== stepIndex) {
      throw new Error('FRESH_SEASON_ONE_RESET_JOURNAL_CONFLICT');
    }
    tx.set(ref, {
      stepIndex: stepIndex + 1,
      updatedAtMs: Date.now(),
      ...(counts ? { counts: { ...current.counts, ...counts } } : {}),
    }, { merge: true });
  });
}

async function deleteDocs(db: any, docs: any[], assertOwnership?: () => Promise<void>) {
  for (let offset = 0; offset < docs.length; offset += 400) {
    await assertOwnership?.();
    const batch = db.batch();
    for (const doc of docs.slice(offset, offset + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
  return docs.length;
}

async function deleteQuery(db: any, query: any, assertOwnership?: () => Promise<void>) {
  const snapshot = await query.get();
  return deleteDocs(db, snapshot.docs, assertOwnership);
}

function isLeagueFixture(data: Record<string, any>) {
  const type = String(data.matchType || data.type || data.competitionType || '').toLowerCase();
  return Number(data.season) === 1 && Number(data.version) === 140 &&
    String(data.leagueId || '') === 'ALPHA' && !data.cupId && !data.tournamentId &&
    !data.isFriendly && !/(cup|tournament|friendly|scrim|association)/.test(type);
}

async function removeOldSeasonOneData(db: any, assertOwnership?: () => Promise<void>) {
  const [matches, cupMatches, cupSnapshots, archiveMatches, slotHistory] = await Promise.all([
    db.collection('matches_v2').where('season', '==', 1).get(),
    db.collection('cup_matches').where('cupId', '==', CUP_ID).get(),
    db.collection('cup_participant_snapshots_v1').doc(CUP_ID).collection('teams').get(),
    db.collection('league_season_archives_v1').doc('S1').collection('matches').get(),
    db.collection('league_slot_history_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
  ]);
  const disposableMatches = matches.docs.filter((doc: any) => {
    const data = doc.data() || {};
    return isLeagueFixture(data) || data.cupId === CUP_ID || doc.id.startsWith('cup_S1_');
  });
  let deleted = 0;
  deleted += await deleteDocs(db, disposableMatches, assertOwnership);
  deleted += await deleteDocs(db, cupMatches.docs, assertOwnership);
  deleted += await deleteDocs(db, cupSnapshots.docs, assertOwnership);
  deleted += await deleteDocs(db, archiveMatches.docs, assertOwnership);
  deleted += await deleteQuery(db, db.collection('match_player_effects_v1')
    .where('matchId', '>=', MATCH_PREFIX).where('matchId', '<', MATCH_PREFIX + '\uf8ff'), assertOwnership);
  deleted += await deleteQuery(db, db.collection('match_player_effects_v1')
    .where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff'), assertOwnership);
  deleted += await deleteQuery(db, db.collection('economy_transactions')
    .where('referenceId', '>=', MATCH_PREFIX).where('referenceId', '<', MATCH_PREFIX + '\uf8ff'), assertOwnership);
  deleted += await deleteQuery(db, db.collection('economy_transactions')
    .where('referenceId', '>=', 'cup_S1_').where('referenceId', '<', 'cup_S1_\uf8ff'), assertOwnership);
  deleted += await deleteQuery(db, db.collection('match_consequence_receipts')
    .where('matchId', '>=', MATCH_PREFIX).where('matchId', '<', MATCH_PREFIX + '\uf8ff'), assertOwnership);
  deleted += await deleteQuery(db, db.collection('match_consequence_receipts')
    .where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff'), assertOwnership);

  const leagueRewards = await db.collection('economy_transactions').where('referenceId', '==', 'S1').get();
  deleted += await deleteDocs(db, leagueRewards.docs.filter((doc: any) => doc.data()?.type === 'LEAGUE_SEASON_REWARD'), assertOwnership);
  const cupRewards = await db.collection('economy_transactions').where('referenceId', '==', CUP_ID).get();
  deleted += await deleteDocs(db, cupRewards.docs.filter((doc: any) =>
    ['PYRAMID_CUP_CHAMPION_REWARD', 'PYRAMID_CUP_FINALIST_REWARD'].includes(String(doc.data()?.type || ''))), assertOwnership);
  deleted += await deleteDocs(db, slotHistory.docs, assertOwnership);

  await assertOwnership?.();
  await db.collection('cup_pyramid_v1').doc(CUP_ID).delete().catch((error: any) => {
    if (error?.code !== 5) throw error;
  });
  await assertOwnership?.();
  await db.collection('league_season_archives_v1').doc('S1').delete().catch((error: any) => {
    if (error?.code !== 5) throw error;
  });
  await assertOwnership?.();
  await db.collection('league_season_rollovers_v1').doc('S2').delete().catch((error: any) => {
    if (error?.code !== 5) throw error;
  });
  await assertOwnership?.();
  await db.collection('league_season_history_v1').doc('S1').delete().catch((error: any) => {
    if (error?.code !== 5) throw error;
  });
  return { deletedDocuments: deleted, oldLeagueFixtures: disposableMatches.filter((doc: any) => isLeagueFixture(doc.data() || {})).length };
}

async function rebuildLeagueIdentity(db: any, now: Date) {
  const [tablesSnap, slotsSnap] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
  ]);
  const participants = new Set<string>();
  for (const table of tablesSnap.docs) {
    for (const [key, value] of Object.entries(table.data()?.stats || {}) as Array<[string, any]>) {
      participants.add(String(value?.id || key));
    }
  }
  if (tablesSnap.size !== 15 || slotsSnap.size !== 120 || participants.size !== 120) {
    throw new Error('FRESH_SEASON_ONE_SOURCE_WORLD_CHANGED');
  }
  const profileSnaps = await db.getAll(...[...participants].map((id: string) => db.collection('players_v14').doc(id)));
  const profiles = new Map<string, Record<string, any>>();
  for (const snap of profileSnaps) {
    if (!snap.exists) throw new Error('FRESH_SEASON_ONE_ACCOUNT_PROFILE_MISSING');
    profiles.set(snap.id, snap.data() || {});
  }
  const built = buildFreshSeasonOneWorldDocuments({
    tables: tablesSnap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() || {} })),
    slots: slotsSnap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() || {} })),
    profiles,
    now,
  });
  if (built.counts.profiles !== 120 || built.counts.tables !== 15 || built.counts.slots !== 120) {
    throw new Error('FRESH_SEASON_ONE_REBUILD_COUNTS_INVALID');
  }
  const writes = [
    ...built.tables.map(item => ({ ref: db.collection('league_tables_v2').doc(item.id), data: item.data })),
    ...built.slots.map(item => ({ ref: db.collection('league_slots_v1').doc(item.id), data: item.data })),
    ...built.profiles.map(item => ({ ref: db.collection('players_v14').doc(item.id), data: item.data })),
  ];
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) batch.set(write.ref, write.data);
    await batch.commit();
  }
  return built.counts;
}

async function configureAndBuildCalendar(db: any, target: ResetJournal['target']) {
  await db.collection('system_v1').doc('season_config').set({
    activeSeasonNumber: 1,
    phase: 'REGULAR_SEASON',
    worldReady: false,
    worldGeneration: 'CLEAN_S1_V1',
    seasonStart: target.seasonStart,
    nextSeasonStart: target.nextSeasonStart,
    calendarRevision: 0,
    stagingFreshSeasonOneReset: true,
    stagingSeasonOneResetInProgress: true,
    pyramidCupRequired: true,
    pyramidCupReady: false,
    pyramidCupReadySeasonNumber: 1,
    nextSeasonNumber: null,
    preparationTargetSeason: null,
    preparedSeasonNumber: null,
    preparedWorldReady: false,
    preparedPublished: false,
    recoveryTargetSeason: null,
    historyCleanupPending: false,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const result: any = await ensureSeasonCalendar(1, { allowDuringStagingReset: true });
  if (result?.success !== true || result?.worldReady !== true) {
    throw new Error(`FRESH_SEASON_ONE_CALENDAR_BUILD_FAILED:${String(result?.reason || result?.action || 'UNKNOWN')}`);
  }
  return result;
}

async function verifyFreshSeasonOne(db: any) {
  const [configSnap, tablesSnap, slotsSnap, matchesSnap, cupSnap, cupMatchesSnap] = await Promise.all([
    db.collection('system_v1').doc('season_config').get(),
    db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
    db.collection('matches_v2').where('season', '==', 1).where('version', '==', 140).where('leagueId', '==', 'ALPHA').get(),
    db.collection('cup_pyramid_v1').doc(CUP_ID).get(),
    db.collection('cup_matches').where('cupId', '==', CUP_ID).get(),
  ]);
  const config = configSnap.exists ? configSnap.data() || {} : {};
  // The reset marker must remain set through every verification read. The
  // executor clears it only in the final transaction after this verification
  // and the journal step have both completed.
  if (!configSnap.exists || config.worldReady !== true ||
      config.pyramidCupReady !== true || config.stagingSeasonOneResetInProgress !== true ||
      tablesSnap.size !== 15 || slotsSnap.size !== 120) {
    throw new Error(
      `FRESH_SEASON_ONE_WORLD_CONFIG_OR_COUNTS_INVALID:worldReady=${String(config.worldReady)},cupReady=${String(config.pyramidCupReady)},resetMarker=${String(config.stagingSeasonOneResetInProgress)},tables=${tablesSnap.size},slots=${slotsSnap.size}`,
    );
  }
  const leagueMatches = matchesSnap.docs.filter((doc: any) => isLeagueFixture(doc.data() || {}));
  if (leagueMatches.length !== 840) throw new Error(`FRESH_SEASON_ONE_LEAGUE_MATCH_COUNT_INVALID:${leagueMatches.length}`);
  if (!cupSnap.exists) throw new Error('FRESH_SEASON_ONE_CUP_MISSING');
  const cup = cupSnap.data() || {};
  if (Number(cup.totalParticipants) !== 120 || Number(cup.totalMatches) !== 119 ||
      Number(cup.formatVersion) !== 4 || cup.format !== 'D1_REST_OPENING_ROUND' ||
      !Array.isArray(cup.participants) || cup.participants.length !== 120 ||
      !Array.isArray(cup.rounds?.r1) || cup.rounds.r1.length !== 56 ||
      cupMatchesSnap.size !== 56) {
    throw new Error('FRESH_SEASON_ONE_CUP_INTEGRITY_INVALID');
  }
  const snapshotDocs = await db.collection('cup_participant_snapshots_v1').doc(CUP_ID).collection('teams').get();
  if (snapshotDocs.size !== 120) throw new Error('FRESH_SEASON_ONE_CUP_SNAPSHOT_COUNT_INVALID');
  const ids = new Set<string>();
  for (const table of tablesSnap.docs) {
    for (const [key, row] of Object.entries(table.data()?.stats || {}) as Array<[string, any]>) {
      if (row?.id !== key || Number(row.matchesPlayed) !== 0 || Number(row.points) !== 0) {
        throw new Error('FRESH_SEASON_ONE_STANDINGS_NOT_RESET');
      }
      ids.add(key);
    }
  }
  if (ids.size !== 120 || cup.participants.some((team: any) => !ids.has(String(team.id)))) {
    throw new Error('FRESH_SEASON_ONE_CUP_PARTICIPANTS_DIVERGED');
  }
  const profiles = await db.getAll(...[...ids].map(id => db.collection('players_v14').doc(id)));
  if (profiles.length !== 120 || profiles.some((profile: any) => !profile.exists ||
      !Array.isArray(profile.data()?.ownedPlayers) ||
      profile.data()!.ownedPlayers.length !== (profile.id.startsWith('BOT_') ? 5 : 10))) {
    throw new Error('FRESH_SEASON_ONE_PROFILE_REBUILD_INVALID');
  }
  return {
    tables: tablesSnap.size, slots: slotsSnap.size, leagueMatches: leagueMatches.length,
    cupParticipants: cup.participants.length, cupMatches: cupMatchesSnap.size,
    cupParticipantSnapshots: snapshotDocs.size,
    humanClubs: profiles.filter((profile: any) => !profile.id.startsWith('BOT_')).length,
    botClubs: profiles.filter((profile: any) => profile.id.startsWith('BOT_')).length,
  };
}

/**
 * Executes only in the caller-fenced Beta project. Each phase is idempotent and
 * journaled; a timed-out worker can safely resume after its lease expires.
 */
export async function executeFreshSeasonOneReset(db: any, target: ResetJournal['target']) {
  const claimed = await claim(db, target);
  if (claimed.completed) return { success: true, alreadyCompleted: true, verification: claimed.journal.counts };
  if (claimed.busy) throw new Error('FRESH_SEASON_ONE_RESET_ALREADY_RUNNING');
  const token = claimed.token as string;
  const journalRef = db.collection('system_v1').doc(JOURNAL_ID);
  const journal = claimed.journal as ResetJournal;
  const resetAt = new Date(journal.startedAtMs);
  try {
    let step = Number(journal.stepIndex || 0);
    if (step <= 0) {
      await assertLease(db, token);
      if (!journal.sourceConfig) throw new Error('RESET_ORIGINAL_CONFIG_ARCHIVE_SOURCE_MISSING');
      const archive = await createOrVerifyDurableSeasonOneArchive(db, journal.resetId, journal.sourceConfig, () => assertLease(db, token));
      await assertLease(db, token);
      const removed = await removeOldSeasonOneData(db, () => assertLease(db, token));
      await saveStep(db, token, 0, { ...removed, archiveDocuments: archive.archiveDocuments });
      step = 1;
    }
    if (step <= 1) {
      await assertLease(db, token);
      const counts = await rebuildLeagueIdentity(db, resetAt);
      await saveStep(db, token, 1, counts);
      step = 2;
    }
    if (step <= 2) {
      await assertLease(db, token);
      const calendar = await configureAndBuildCalendar(db, target);
      await saveStep(db, token, 2, {
        calendarMatches: Number(calendar.totalExpectedMatches || 840),
        calendarWorldReady: calendar.worldReady === true ? 1 : 0,
      });
      step = 3;
    }
    if (step <= 3) {
      await assertLease(db, token);
      const verification = await verifyFreshSeasonOne(db);
      await saveStep(db, token, 3, verification);
      step = 4;
    }
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(journalRef);
      const current = snap.exists ? snap.data() as ResetJournal : null;
      if (!current || current.lease?.token !== token || current.stepIndex !== 4) {
        throw new Error('FRESH_SEASON_ONE_RESET_FINALIZE_CONFLICT');
      }
      tx.set(journalRef, {
        status: 'COMPLETED', lease: null, updatedAtMs: Date.now(),
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(db.collection('system_v1').doc('season_config'), {
        stagingSeasonOneResetInProgress: false,
        stagingFreshSeasonOneReset: false,
        pyramidCupRequired: true,
        pyramidCupReady: true,
        pyramidCupReadySeasonNumber: 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    const finalJournal = await journalRef.get();
    return { success: true, resetId: journal.resetId, verification: finalJournal.data()?.counts || {} };
  } catch (error) {
    const code = errorCode(error);
    await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(journalRef);
      const current = snap.exists ? snap.data() as ResetJournal : null;
      if (current?.lease?.token === token) {
        tx.set(journalRef, {
          status: 'FAILED', lease: null, lastError: code, updatedAtMs: Date.now(),
        }, { merge: true });
      }
    }).catch(() => undefined);
    throw error;
  }
}
