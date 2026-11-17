import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  acquireSeasonCalendarBuildLock,
  commitSeasonCalendarPublication,
  commitSeasonHistoryCleanupWrites,
  releaseSeasonCalendarBuildLock,
  SEASON_CALENDAR_BUILD_LOCK_ID,
} from '../src/app/actions/season-rollover-lock.ts';
import { completeSeasonHistoryCleanup } from '../src/app/actions/season-history-cleanup.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

// Map every production collection lookup to a disposable test collection.
// In particular, system_v1/season_config and the shared calendar lock are
// NEVER read or written by these tests.
function isolatedDb(firestore, collectionName) {
  return {
    collection: () => firestore.collection(collectionName),
    runTransaction: fn => firestore.runTransaction(fn),
  };
}

async function withIsolatedFirestore(t) {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');
  const app = initializeApp({ projectId }, `season-publication-test-${randomUUID()}`);
  const firestore = getFirestore(app);
  const collectionName = `seasonLifecycleIntegrationTests_${randomUUID().replaceAll('-', '')}`;
  const db = isolatedDb(firestore, collectionName);
  const refs = new Set();
  const doc = id => {
    const ref = db.collection('system_v1').doc(id);
    refs.add(ref);
    return ref;
  };
  t.after(async () => {
    await Promise.all([...refs].map(ref => ref.delete().catch(() => undefined)));
    await deleteApp(app);
  });
  return { db, doc };
}

test('Firestore Emulator publication is fenced and cannot publish twice', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  const planRef = doc('S2');
  doc(SEASON_CALENDAR_BUILD_LOCK_ID);

  await configRef.set({
    activeSeasonNumber: 1,
    nextSeasonNumber: 2,
    preparationTargetSeason: 2,
    worldReady: true,
    preparedWorldReady: true,
    preparedSeasonNumber: 2,
    preparedCalendarRevision: 4,
    phase: 'GENERATING_NEXT',
  });
  await planRef.set({ ready: true, sourceSeason: 1, targetSeason: 2 });

  const lease = await acquireSeasonCalendarBuildLock(db, 1, 2);
  assert.equal(lease.acquired, true);
  const expected = {
    sourceSeason: 1,
    targetSeason: 2,
    calendarRevision: 4,
    phase: 'GENERATING_NEXT',
    planRef,
    validatePlan: plan => plan.ready === true && plan.sourceSeason === 1 && plan.targetSeason === 2,
    publicationDeadlineMs: Date.now() + 60_000,
    activationAtMs: Date.now() + 120_000,
  };
  const publication = {
    ref: configRef,
    data: { preparedPublished: true, phase: 'PUBLISHED' },
    options: { merge: true },
  };
  try {
    const first = await commitSeasonCalendarPublication(db, lease.ownerId, lease.token, expected, publication);
    assert.equal(first.committed, true);
    assert.equal((await configRef.get()).get('activeSeasonNumber'), 1);
    assert.equal((await configRef.get()).get('preparedPublished'), true);

    await assert.rejects(
      () => commitSeasonCalendarPublication(db, lease.ownerId, lease.token, expected, publication),
      /SEASON_CALENDAR_PUBLICATION_STATE_CHANGED/,
    );
    assert.equal((await configRef.get()).get('phase'), 'PUBLISHED');

    await planRef.update({ ready: false });
    await assert.rejects(
      () => commitSeasonCalendarPublication(
        db, lease.ownerId, lease.token,
        { ...expected, phase: 'PUBLISHED' }, publication,
      ),
      /SEASON_CALENDAR_PUBLICATION_PLAN_CHANGED/,
    );
    assert.equal((await configRef.get()).get('preparedPublished'), true);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lease.ownerId, lease.token);
  }
});

test('Firestore Emulator history cleanup rejects stale workers and changed active season', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  const oldArchiveRef = doc('old-archive');
  const lockRef = doc(SEASON_CALENDAR_BUILD_LOCK_ID);
  await configRef.set({
    activeSeasonNumber: 2,
    worldReady: true,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 2,
  });
  await oldArchiveRef.set({ seasonNumber: 0, disposable: true });
  const lease = await acquireSeasonCalendarBuildLock(db, 1, 2);
  assert.equal(lease.acquired, true);
  try {
    await assert.rejects(
      () => commitSeasonHistoryCleanupWrites(db, lease.ownerId, 'stale-token', 2, [], [oldArchiveRef]),
      /SEASON_CALENDAR_BUILD_LOCK_LOST/,
    );
    assert.equal((await oldArchiveRef.get()).exists, true);

    await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 2, [], [oldArchiveRef]);
    assert.equal((await oldArchiveRef.get()).exists, false);

    await configRef.update({ activeSeasonNumber: 3 });
    await assert.rejects(
      () => commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 2,
        [{ ref: oldArchiveRef, data: { recreated: true } }]),
      /SEASON_HISTORY_CLEANUP_TARGET_CHANGED/,
    );
    assert.equal((await oldArchiveRef.get()).exists, false);

    await configRef.update({ activeSeasonNumber: 2, historyCleanupPending: false });
    await assert.rejects(
      () => commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 2,
        [{ ref: oldArchiveRef, data: { recreated: true } }]),
      /SEASON_HISTORY_CLEANUP_TARGET_CHANGED/,
    );
    assert.equal((await oldArchiveRef.get()).exists, false);
    assert.equal((await lockRef.get()).exists, true);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lease.ownerId, lease.token);
  }
});


test('Firestore Emulator clears the cleanup marker only for the active target and only once', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  await configRef.set({
    activeSeasonNumber: 3,
    worldReady: true,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 2,
  });

  const wrongTarget = await completeSeasonHistoryCleanup(db, 2);
  assert.deepEqual(wrongTarget, {
    ready: false,
    reason: 'HISTORY_CLEANUP_TARGET_CHANGED',
    shouldMarkComplete: false,
  });
  assert.equal((await configRef.get()).get('historyCleanupPending'), true);
  assert.equal((await configRef.get()).get('historyCleanupCompletedAt'), undefined);

  await configRef.update({ activeSeasonNumber: 2 });
  const concurrent = await Promise.all([
    completeSeasonHistoryCleanup(db, 2),
    completeSeasonHistoryCleanup(db, 2),
  ]);
  assert.equal(concurrent.every(result => result.ready), true);
  assert.equal(concurrent.filter(result => result.shouldMarkComplete).length, 1);

  const completed = await configRef.get();
  assert.equal(completed.get('activeSeasonNumber'), 2);
  assert.equal(completed.get('worldReady'), true);
  assert.equal(completed.get('historyCleanupPending'), false);
  assert.ok(completed.get('historyCleanupCompletedAt'));

  const retry = await completeSeasonHistoryCleanup(db, 2);
  assert.deepEqual(retry, {
    ready: true,
    reason: null,
    shouldMarkComplete: false,
  });
  assert.equal((await configRef.get()).get('historyCleanupPending'), false);
});
