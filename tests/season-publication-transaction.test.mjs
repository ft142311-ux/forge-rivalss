import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSeasonCalendarBuildLock,
  commitSeasonCalendarPublication,
  releaseSeasonCalendarBuildLock,
  SEASON_CALENDAR_BUILD_LOCK_ID,
} from '../src/app/actions/season-rollover-lock.ts';

function publicationDb({ lock, config }) {
  const state = new Map([
    [SEASON_CALENDAR_BUILD_LOCK_ID, lock],
    ['season_config', config],
  ]);
  let writes = 0;
  let queue = Promise.resolve();
  return {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: fn => {
      const operation = queue.then(async () => {
        const pending = [];
        const tx = {
          get: async ref => ({ exists: state.has(ref.id) && state.get(ref.id) !== null, data: () => state.get(ref.id) }),
          set: (ref, value, options) => pending.push({ type: 'set', ref, value, options }),
          delete: ref => pending.push({ type: 'delete', ref }),
        };
        const result = await fn(tx);
        for (const write of pending) {
          if (write.type === 'delete') state.delete(write.ref.id);
          else if (write.options?.merge) state.set(write.ref.id, { ...(state.get(write.ref.id) || {}), ...write.value });
          else state.set(write.ref.id, write.value);
          writes++;
        }
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
    read: id => state.get(id),
    replace: (id, value) => state.set(id, value),
    writes: () => writes,
  };
}

const expected = {
  sourceSeason: 1,
  targetSeason: 2,
  calendarRevision: 4,
  phase: 'GENERATING_NEXT',
};

test('publication rejects a concurrent season_config state change', async () => {
  const db = publicationDb({
    lock: { ownerId: 'owner', token: 'token', expiresAtMs: Date.now() + 60_000 },
    config: { activeSeasonNumber: 9, nextSeasonNumber: 10, worldReady: false, calendarRevision: 4, phase: 'GENERATING_NEXT' },
  });

  await assert.rejects(
    () => commitSeasonCalendarPublication(db, 'owner', 'token', expected, { ref: { id: 'season_config' }, data: {} }),
    /SEASON_CALENDAR_PUBLICATION_STATE_CHANGED/,
  );
  assert.equal(db.writes(), 0);
});

test('publication rejects an expired lock', async () => {
  const db = publicationDb({
    lock: { ownerId: 'owner', token: 'token', expiresAtMs: Date.now() - 1 },
    config: { activeSeasonNumber: 1, nextSeasonNumber: 2, worldReady: false, calendarRevision: 4, phase: 'GENERATING_NEXT' },
  });

  await assert.rejects(
    () => commitSeasonCalendarPublication(db, 'owner', 'token', expected, { ref: { id: 'season_config' }, data: {} }),
    /SEASON_CALENDAR_BUILD_LOCK_LOST/,
  );
  assert.equal(db.writes(), 0);
});

test('publication rejects a replaced lock token', async () => {
  const db = publicationDb({
    lock: { ownerId: 'replacement-owner', token: 'replacement-token', expiresAtMs: Date.now() + 60_000 },
    config: { activeSeasonNumber: 1, nextSeasonNumber: 2, worldReady: false, calendarRevision: 4, phase: 'GENERATING_NEXT' },
  });

  await assert.rejects(
    () => commitSeasonCalendarPublication(db, 'owner', 'token', expected, { ref: { id: 'season_config' }, data: {} }),
    /SEASON_CALENDAR_BUILD_LOCK_LOST/,
  );
  assert.equal(db.writes(), 0);
});

test('publication commits only after lock and config checks pass', async () => {
  const db = publicationDb({
    lock: { ownerId: 'owner', token: 'token', expiresAtMs: Date.now() + 60_000 },
    config: { activeSeasonNumber: 1, nextSeasonNumber: 2, preparationTargetSeason: 2, worldReady: false, calendarRevision: 4, phase: 'GENERATING_NEXT' },
  });

  const result = await commitSeasonCalendarPublication(
    db,
    'owner',
    'token',
    expected,
    { ref: { id: 'season_config' }, data: { activeSeasonNumber: 2, worldReady: true } },
  );

  assert.equal(result.committed, true);
  assert.equal(db.writes(), 1);
});

test('publication rejects a rollover-plan changed after preliminary validation', async () => {
  const planRef = { id: 'S2' };
  const db = publicationDb({
    lock: { ownerId: 'owner', token: 'token', expiresAtMs: Date.now() + 60_000 },
    config: { activeSeasonNumber: 1, nextSeasonNumber: 2, preparationTargetSeason: 2, worldReady: false, calendarRevision: 4, phase: 'GENERATING_NEXT' },
  });
  db.replace('S2', { ready: true, sourceSeason: 1, targetSeason: 2, revision: 1 });
  const preliminaryPlan = db.read('S2');
  assert.equal(preliminaryPlan.revision, 1);
  db.replace('S2', { ready: false, sourceSeason: 1, targetSeason: 2, revision: 2 });

  await assert.rejects(
    () => commitSeasonCalendarPublication(
      db,
      'owner',
      'token',
      { ...expected, planRef, validatePlan: plan => plan.ready === true && plan.revision === 1 },
      { ref: { id: 'season_config' }, data: { activeSeasonNumber: 2, worldReady: true } },
    ),
    /SEASON_CALENDAR_PUBLICATION_PLAN_CHANGED/,
  );
  assert.equal(db.writes(), 0);
});

test('two complete competing publication attempts allow at most one commit and a repeat is rejected', async () => {
  const db = publicationDb({
    lock: null,
    config: { activeSeasonNumber: 1, nextSeasonNumber: 2, preparationTargetSeason: 2, worldReady: false, calendarRevision: 4, phase: 'GENERATING_NEXT' },
  });
  const attempt = async ownerId => {
    const lock = await acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId });
    if (!lock.acquired) return false;
    try {
      await commitSeasonCalendarPublication(
        db,
        ownerId,
        lock.token,
        expected,
        { ref: { id: 'season_config' }, data: { activeSeasonNumber: 2, worldReady: true }, options: { merge: true } },
      );
      return true;
    } catch {
      return false;
    } finally {
      await releaseSeasonCalendarBuildLock(db, ownerId, lock.token);
    }
  };

  const results = await Promise.all([attempt('publisher-a'), attempt('publisher-b')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(db.read('season_config').activeSeasonNumber, 2);
  assert.equal(db.read('season_config').worldReady, true);
  assert.equal(await attempt('publisher-repeat'), false);
  assert.equal(db.read('season_config').activeSeasonNumber, 2);
});
