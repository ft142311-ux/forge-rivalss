import test from 'node:test';
import assert from 'node:assert/strict';
import { commitSeasonActivation } from '../src/app/actions/season-activation-commit.ts';

const activationAtMs = 10_000;
const nextSeasonStartMs = 20_000;
const configRef = { id: 'season_config' };
const planRef = { id: 'S2' };

function preparedConfig() {
  return {
    activeSeasonNumber: 1,
    nextSeasonNumber: 2,
    preparationTargetSeason: 2,
    preparedSeasonNumber: 2,
    worldReady: true,
    preparedWorldReady: true,
    preparedPublished: true,
    preparedCalendarRevision: 4,
    preparedSeasonStart: new Date(activationAtMs).toISOString(),
    preparedNextSeasonStart: new Date(nextSeasonStartMs).toISOString(),
    nextSeasonStart: new Date(activationAtMs).toISOString(),
    preparedRecoveryMode: false,
    phase: 'PUBLISHED',
  };
}

function activationDb({ config = preparedConfig(), plan = { ready: true }, failBeforeCommit = false } = {}) {
  const state = new Map([['season_config', config], ['S2', plan]]);
  let updateCount = 0;
  let queue = Promise.resolve();
  return {
    runTransaction(fn) {
      const operation = queue.then(async () => {
        const pending = [];
        const tx = {
          get: async ref => ({
            exists: state.has(ref.id),
            data: () => state.get(ref.id),
          }),
          update: (ref, value) => pending.push({ ref, value }),
        };
        const result = await fn(tx);
        if (failBeforeCommit) throw new Error('INJECTED_BEFORE_COMMIT');
        for (const write of pending) {
          state.set(write.ref.id, { ...(state.get(write.ref.id) || {}), ...write.value });
          updateCount++;
        }
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
    read: id => state.get(id),
    updateCount: () => updateCount,
  };
}

function expected(overrides = {}) {
  return {
    sourceSeason: 1,
    targetSeason: 2,
    calendarRevision: 4,
    activationAtMs,
    nextSeasonStartMs,
    multiSeasonRecovery: false,
    recoveryMode: false,
    nowMs: 15_000,
    isPlanReady: plan => plan?.ready === true,
    buildUpdate: current => ({
      activeSeasonNumber: 2,
      phase: 'REGULAR_SEASON',
      worldReady: true,
      seasonStart: current.preparedSeasonStart,
      nextSeasonStart: current.preparedNextSeasonStart,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 2,
      preparedSeasonNumber: undefined,
    }),
    ...overrides,
  };
}

test('activation commits active season and cleanup marker atomically', async () => {
  const db = activationDb();
  const result = await commitSeasonActivation(db, configRef, planRef, expected());

  assert.deepEqual(result, { success: true });
  const config = db.read('season_config');
  assert.equal(config.activeSeasonNumber, 2);
  assert.equal(config.worldReady, true);
  assert.equal(config.phase, 'REGULAR_SEASON');
  assert.equal(config.historyCleanupPending, true);
  assert.equal(config.historyCleanupTargetSeason, 2);
  assert.equal(config.preparedSeasonNumber, undefined);
  assert.equal(db.updateCount(), 1);
});

test('a process failure before transaction commit leaves the source season untouched', async () => {
  const db = activationDb({ failBeforeCommit: true });

  await assert.rejects(
    () => commitSeasonActivation(db, configRef, planRef, expected()),
    /INJECTED_BEFORE_COMMIT/,
  );
  assert.equal(db.read('season_config').activeSeasonNumber, 1);
  assert.equal(db.read('season_config').historyCleanupPending, undefined);
  assert.equal(db.updateCount(), 0);
});

test('retry after committed activation cannot activate the same target twice', async () => {
  const db = activationDb();
  const first = await commitSeasonActivation(db, configRef, planRef, expected());
  const retry = await commitSeasonActivation(db, configRef, planRef, expected());

  assert.deepEqual(first, { success: true });
  assert.deepEqual(retry, { success: false, reason: 'ACTIVATION_STATE_CHANGED' });
  assert.equal(db.read('season_config').activeSeasonNumber, 2);
  assert.equal(db.updateCount(), 1);
});

test('invalid or changed rollover plan blocks activation without config writes', async () => {
  const db = activationDb({ plan: { ready: false } });
  const result = await commitSeasonActivation(db, configRef, planRef, expected());

  assert.deepEqual(result, { success: false, reason: 'ROLLOVER_PLAN_INVALID' });
  assert.equal(db.read('season_config').activeSeasonNumber, 1);
  assert.equal(db.updateCount(), 0);
});

test('activation is rejected before its scheduled boundary and after the next boundary', async () => {
  for (const [nowMs, reason] of [
    [activationAtMs - 1, 'ACTIVATION_NOT_DUE'],
    [nextSeasonStartMs, 'ACTIVATION_WINDOW_EXPIRED'],
  ]) {
    const db = activationDb();
    const result = await commitSeasonActivation(db, configRef, planRef, expected({ nowMs }));
    assert.deepEqual(result, { success: false, reason });
    assert.equal(db.read('season_config').activeSeasonNumber, 1);
    assert.equal(db.updateCount(), 0);
  }
});

test('two concurrent activation attempts can commit only once', async () => {
  const db = activationDb();
  const results = await Promise.all([
    commitSeasonActivation(db, configRef, planRef, expected()),
    commitSeasonActivation(db, configRef, planRef, expected()),
  ]);

  assert.equal(results.filter(result => result.success).length, 1);
  assert.equal(results.filter(result => result.reason === 'ACTIVATION_STATE_CHANGED').length, 1);
  assert.equal(db.read('season_config').activeSeasonNumber, 2);
  assert.equal(db.updateCount(), 1);
});

test('multi-season recovery does not require the source nextSeasonStart to equal the target start', async () => {
  const config = preparedConfig();
  config.nextSeasonStart = new Date(activationAtMs - 5_000).toISOString();
  const db = activationDb({ config });
  const result = await commitSeasonActivation(db, configRef, planRef, expected({ multiSeasonRecovery: true }));

  assert.deepEqual(result, { success: true });
  assert.equal(db.read('season_config').activeSeasonNumber, 2);
});
