import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSeasonRolloverLock,
  assertSeasonRolloverLock,
  renewSeasonRolloverLock,
  commitSeasonRolloverWrites,
  releaseSeasonRolloverLock,
  acquireSeasonCalendarBuildLock,
  assertSeasonCalendarBuildLock,
  commitSeasonCalendarWrites,
  releaseSeasonCalendarBuildLock,
} from '../src/app/actions/season-rollover-lock.ts';
import { buildPromotionRelegationGroups, validateRolloverPlan, expectedRolloverGroups } from '../src/app/actions/season-rollover-plan.ts';
import { cronResultStatus } from '../src/app/api/cron/cron-result.ts';
import { calendarBlockedResult, isCalendarReady } from '../src/app/actions/season-calendar-gate.ts';

function mockDb(initial = null) {
  const states = new Map([['season_rollover_v1', initial]]);
  let queue = Promise.resolve();
  return {
    collection: () => ({ doc: id => ({ id, get: async () => ({ exists: Boolean(states.get(id)), data: () => states.get(id) }) }) }),
    runTransaction: fn => {
      const next = queue.then(async () => {
        const tx = {
          get: async ref => ({ exists: Boolean(states.get(ref.id)), data: () => states.get(ref.id) }),
          set: (ref, value) => { states.set(ref.id, { ...(states.get(ref.id) || {}), ...value }); },
          delete: ref => { states.set(ref.id, null); },
        };
        return fn(tx);
      });
      queue = next.catch(() => {});
      return next;
    },
    read: (id = 'season_rollover_v1') => states.get(id),
  };
}

test('two simultaneous rollover attempts have one owner', async () => {
  const db = mockDb();
  const [a, b] = await Promise.all([
    acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'A', nowMs: 100 }),
    acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'B', nowMs: 100 }),
  ]);
  assert.deepEqual([a.acquired, b.acquired].sort(), [false, true]);
  assert.equal(db.read().ownerId, a.acquired ? 'A' : 'B');
});

test('foreign owner cannot release the rollover lock', async () => {
  const db = mockDb();
  await acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'owner', nowMs: 100 });
  const result = await releaseSeasonRolloverLock(db, 'other');
  assert.equal(result.released, false);
  assert.equal(db.read().ownerId, 'owner');
});

test('expired rollover lock can be recovered by a new owner', async () => {
  const db = mockDb();
  await acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'old', nowMs: 100, ttlMs: 10 });
  const result = await acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'new', nowMs: 111 });
  assert.equal(result.acquired, true);
  assert.equal(db.read().ownerId, 'new');
});

test('two simultaneous calendar builds have one owner', async () => {
  const db = mockDb();
  const [a, b] = await Promise.all([
    acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'builder-a', nowMs: 100 }),
    acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'builder-b', nowMs: 100 }),
  ]);
  assert.deepEqual([a.acquired, b.acquired].sort(), [false, true]);
});

test('repair calendar path is blocked while another calendar owner is active', async () => {
  const db = mockDb();
  await acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'builder', nowMs: 100 });
  const repairAttempt = await acquireSeasonCalendarBuildLock(db, 1, 1, { ownerId: 'repair', nowMs: 100 });
  assert.equal(repairAttempt.acquired, false);
});

test('expired calendar owner is fenced and cannot release the replacement lock', async () => {
  const db = mockDb();
  const old = await acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'old-builder', nowMs: 100, ttlMs: 10 });
  const current = await acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'new-builder', nowMs: 111 });
  await assert.rejects(() => assertSeasonCalendarBuildLock(db, old.ownerId, old.token, 111), /SEASON_CALENDAR_BUILD_LOCK_LOST/);
  assert.equal((await releaseSeasonCalendarBuildLock(db, old.ownerId, old.token)).released, false);
  assert.equal(db.read('season_calendar_build_v1').ownerId, current.ownerId);
  assert.equal((await releaseSeasonCalendarBuildLock(db, current.ownerId, current.token)).released, true);
});

test('expired calendar owner cannot commit a protected write', async () => {
  const db = mockDb();
  const old = await acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'old-writer', nowMs: 100, ttlMs: 10 });
  await acquireSeasonCalendarBuildLock(db, 1, 2, { ownerId: 'new-writer', nowMs: 111 });
  const ref = db.collection('protected').doc('doc');
  await assert.rejects(
    () => commitSeasonCalendarWrites(db, old.ownerId, old.token, [{ ref, data: { value: 'stale' } }]),
    /SEASON_CALENDAR_BUILD_LOCK_LOST/,
  );
});

function fullPlan() {
  const groups = {};
  for (const group of expectedRolloverGroups()) {
    groups[group] = Array.from({ length: 8 }, (_, i) => ({ id: `${group}-team-${i + 1}`, rank: i + 1 }));
  }
  return { sourceSeason: 1, targetSeason: 2, ready: true, groups };
}

test('incomplete and duplicate-slot plans are rejected; full plan is reusable', () => {
  const plan = fullPlan();
  assert.equal(validateRolloverPlan({ ...plan, groups: { ...plan.groups, 'D1-G1': plan.groups['D1-G1'].slice(0, 7) } }, 1, 2).valid, false);
  const duplicate = fullPlan();
  duplicate.groups['D2-G1'][0].id = duplicate.groups['D1-G1'][0].id;
  assert.equal(validateRolloverPlan(duplicate, 1, 2).valid, false);
  assert.equal(validateRolloverPlan(plan, 1, 2).valid, true);
});

test('promotion and relegation move the correct teams through all four divisions', () => {
  const standings = {};
  for (const group of expectedRolloverGroups()) {
    standings[group] = Array.from({ length: 8 }, (_, index) => ({
      id: `${group}-R${index + 1}`,
      rank: index + 1,
      matchesPlayed: 14,
      points: 42 - index,
      wins: 14 - index,
      draws: 0,
      losses: index,
      diff: 20 - index,
    }));
  }

  const result = buildPromotionRelegationGroups(standings);
  assert.equal(result.ready, true);
  assert.equal(Object.keys(result.groups).length, 15);
  assert.equal(validateRolloverPlan({
    sourceSeason: 1,
    targetSeason: 2,
    ready: true,
    groups: result.groups,
  }, 1, 2).valid, true);

  const ids = key => result.groups[key].map(team => team.id);
  assert.deepEqual(ids('D1-G1'), [
    'D1-G1-R1', 'D1-G1-R2', 'D1-G1-R3', 'D1-G1-R4', 'D1-G1-R5', 'D1-G1-R6',
    'D2-G1-R1', 'D2-G2-R1',
  ]);
  assert.deepEqual(ids('D2-G1'), [
    'D2-G1-R2', 'D2-G1-R3', 'D2-G1-R4', 'D2-G1-R5', 'D2-G1-R6',
    'D1-G1-R1', 'D3-G1-R1', 'D3-G2-R1',
  ]);
  assert.deepEqual(ids('D3-G1'), [
    'D3-G1-R2', 'D3-G1-R3', 'D3-G1-R4', 'D3-G1-R5', 'D3-G1-R6',
    'D2-G1-R1', 'D4-G1-R1', 'D4-G2-R1',
  ]);
  assert.deepEqual(ids('D4-G1'), [
    'D4-G1-R2', 'D4-G1-R3', 'D4-G1-R4', 'D4-G1-R5', 'D4-G1-R6', 'D4-G1-R7', 'D4-G1-R8',
    'D3-G1-R1',
  ]);

  for (const teams of Object.values(result.groups)) {
    assert.deepEqual(teams.map(team => team.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(teams.every(team => team.matchesPlayed === 0 && team.points === 0));
  }
  const allIds = Object.values(result.groups).flat().map(team => team.id);
  assert.equal(allIds.length, 120);
  assert.equal(new Set(allIds).size, 120);
});

test('promotion/relegation mapping blocks a missing parent or child champion', () => {
  const standings = Object.fromEntries(expectedRolloverGroups().map(group => [
    group,
    Array.from({ length: 8 }, (_, index) => ({ id: `${group}-R${index + 1}`, rank: index + 1 })),
  ]));
  standings['D2-G1'] = standings['D2-G1'].slice(0, 7);
  const result = buildPromotionRelegationGroups(standings);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'ROLLOVER_GROUP_SIZE_INVALID');
  assert.equal(result.group, 'D1-G1');
});

test('cron controlled failures use a non-success HTTP status', () => {
  assert.equal(cronResultStatus({ success: true }), 200);
  assert.equal(cronResultStatus({ success: false }), 409);
  assert.equal(cronResultStatus({}), 409);
});

test('calendar lock refusal stops orchestrator and match cron work', () => {
  const blocked = { success: false, worldReady: false, reason: 'SEASON_CALENDAR_BUILD_LOCKED' };
  assert.equal(isCalendarReady(blocked), false);
  assert.deepEqual(calendarBlockedResult(blocked), {
    success: false,
    action: 'WORLD_BUILDING',
    worldReady: false,
    calendar: blocked,
  });
  assert.equal(isCalendarReady({ success: true, worldReady: false }), false);
  assert.equal(isCalendarReady({ success: true, worldReady: true }), true);
});


test('rollover lease can be renewed only by its live owner', async () => {
  const db = mockDb();
  const lease = await acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'rollover-owner', nowMs: 100, ttlMs: 50 });
  assert.equal(lease.acquired, true);
  const renewed = await renewSeasonRolloverLock(db, lease.ownerId, lease.token, { nowMs: 120, ttlMs: 100 });
  assert.deepEqual(renewed, { renewed: true, expiresAtMs: 220 });
  assert.equal(await assertSeasonRolloverLock(db, lease.ownerId, lease.token, 219), true);
  await assert.rejects(() => renewSeasonRolloverLock(db, 'other', lease.token, { nowMs: 130 }), /SEASON_ROLLOVER_LOCK_LOST/);
});

test('expired rollover lease cannot commit protected writes', async () => {
  const db = mockDb();
  const old = await acquireSeasonRolloverLock(db, 1, 2, { ownerId: 'old-rollover', nowMs: Date.now() - 1000, ttlMs: 1 });
  const protectedRef = db.collection('protected').doc('season-slot');
  await assert.rejects(
    () => commitSeasonRolloverWrites(db, old.ownerId, old.token, [{ ref: protectedRef, data: { occupantId: 'stale-writer' } }]),
    /SEASON_ROLLOVER_LOCK_LOST/,
  );
  assert.equal(db.read('season-slot'), undefined);
});
