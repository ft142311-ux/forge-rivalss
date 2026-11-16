import test from 'node:test';
import assert from 'node:assert/strict';
import { commitSeasonHistoryCleanupWrites } from '../src/app/actions/season-rollover-lock.ts';

function makeDb({ lock, config } = {}) {
  const state = new Map([
    ['season_calendar_build_v1', lock],
    ['season_config', config],
  ]);
  let transactionCount = 0;
  return {
    state,
    transactionCount: () => transactionCount,
    collection(name) {
      return {
        doc(id) {
          return { id: name + '/' + id };
        },
      };
    },
    async runTransaction(callback) {
      transactionCount++;
      const pending = [];
      const tx = {
        async get(ref) {
          const value = state.get(ref.id);
          return { exists: value !== undefined, data: () => value };
        },
        set(ref, data, options) {
          pending.push({ type: 'set', ref, data, options });
        },
        delete(ref) {
          pending.push({ type: 'delete', ref });
        },
      };
      const result = await callback(tx);
      for (const write of pending) {
        if (write.type === 'delete') {
          state.delete(write.ref.id);
        } else {
          const previous = state.get(write.ref.id) || {};
          state.set(write.ref.id, write.options?.merge ? { ...previous, ...write.data } : write.data);
        }
      }
      return result;
    },
  };
}

function validState(overrides = {}) {
  const now = Date.now();
  return {
    lock: {
      ownerId: 'cleanup-worker',
      token: 'fencing-token',
      expiresAtMs: now + 60_000,
    },
    config: {
      activeSeasonNumber: 4,
      worldReady: true,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 4,
    },
    ...overrides,
  };
}

test('history cleanup writes and deletes commit atomically under the active season lease', async () => {
  const db = makeDb(validState());
  const archiveRef = { id: 'league_season_archives_v1/S1' };
  const childRef = { id: 'league_season_archives_v1/S1/matches/M1' };
  const markerRef = { id: 'league_season_history_v1/S2' };

  await commitSeasonHistoryCleanupWrites(
    db,
    'cleanup-worker',
    'fencing-token',
    4,
    [{ ref: markerRef, data: { status: 'SKIPPED' }, options: { merge: true } }],
    [childRef, archiveRef],
  );

  assert.equal(db.state.get(markerRef.id).status, 'SKIPPED');
  assert.equal(db.state.has(childRef.id), false);
  assert.equal(db.state.has(archiveRef.id), false);
  assert.ok(db.state.get('system_v1/season_calendar_build_v1').expiresAtMs > Date.now());
  assert.equal(db.transactionCount(), 1);
});

test('a stale or replaced cleanup lease blocks every mutation', async () => {
  for (const lock of [
    { ownerId: 'cleanup-worker', token: 'old-token', expiresAtMs: Date.now() + 60_000 },
    { ownerId: 'cleanup-worker', token: 'fencing-token', expiresAtMs: Date.now() - 1 },
    { ownerId: 'another-worker', token: 'fencing-token', expiresAtMs: Date.now() + 60_000 },
  ]) {
    const db = makeDb(validState({ lock }));
    const markerRef = { id: 'league_season_history_v1/S2' };
    await assert.rejects(
      commitSeasonHistoryCleanupWrites(db, 'cleanup-worker', 'fencing-token', 4, [
        { ref: markerRef, data: { status: 'SKIPPED' } },
      ]),
      /SEASON_CALENDAR_BUILD_LOCK_LOST/,
    );
    assert.equal(db.state.has(markerRef.id), false);
  }
});

test('a stale cleanup target cannot delete an archive after a newer season activates', async () => {
  const db = makeDb(validState({
    config: {
      activeSeasonNumber: 5,
      worldReady: true,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 5,
    },
  }));
  const archiveRef = { id: 'league_season_archives_v1/S1' };

  await assert.rejects(
    commitSeasonHistoryCleanupWrites(db, 'cleanup-worker', 'fencing-token', 4, [], [archiveRef]),
    /SEASON_HISTORY_CLEANUP_TARGET_CHANGED/,
  );
  assert.equal(db.state.has(archiveRef.id), false);
});

test('cleanup refuses to mutate when the durable cleanup marker is absent or already completed', async () => {
  for (const config of [
    { activeSeasonNumber: 4, worldReady: true, historyCleanupTargetSeason: 4, historyCleanupPending: false },
    { activeSeasonNumber: 4, worldReady: false, historyCleanupTargetSeason: 4, historyCleanupPending: true },
    { activeSeasonNumber: 4, worldReady: true, historyCleanupTargetSeason: 3, historyCleanupPending: true },
  ]) {
    const db = makeDb(validState({ config }));
    const archiveRef = { id: 'league_season_archives_v1/S1' };
    await assert.rejects(
      commitSeasonHistoryCleanupWrites(db, 'cleanup-worker', 'fencing-token', 4, [], [archiveRef]),
      /SEASON_HISTORY_CLEANUP_TARGET_CHANGED/,
    );
    assert.equal(db.state.has(archiveRef.id), false);
  }
});

test('cleanup enforces Firestore-safe chunk bounds before opening a transaction', async () => {
  const db = makeDb(validState());
  const deletes = Array.from({ length: 451 }, (_, index) => ({ id: `archive/${index}` }));

  await assert.rejects(
    commitSeasonHistoryCleanupWrites(db, 'cleanup-worker', 'fencing-token', 4, [], deletes),
    /SEASON_HISTORY_CLEANUP_CHUNK_TOO_LARGE/,
  );
  assert.equal(db.transactionCount(), 0);
});
