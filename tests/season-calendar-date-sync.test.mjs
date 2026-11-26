import test from 'node:test';
import assert from 'node:assert/strict';
import { canPrepareImmediateCatchUpTarget, deriveSeasonDatePlan, evaluateExpiredSeasonArchives } from '../src/app/actions/season-boundary.ts';

const seasonOne = new Date('2026-09-21T15:00:00.000Z');
const seasonTwo = new Date('2026-10-08T15:00:00.000Z');

function planAt(now, active = 1, start = seasonOne, next = seasonTwo) {
  return deriveSeasonDatePlan(active, start, next, new Date(now), 15);
}

test('S1 verified and S2 is the current calendar season before the next boundary', () => {
  const plan = planAt('2026-10-17T15:00:00.000Z');
  assert.equal(plan.expectedSeasonNumber, 2);
  assert.equal(plan.expectedSeasonStart.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(plan.expectedNextSeasonStart.toISOString(), '2026-10-23T15:00:00.000Z');
  assert.deepEqual(plan.completedSeasons, [1]);
  assert.equal(evaluateExpiredSeasonArchives(plan, {}).ready, true);
});

test('completed S2 with a valid immutable archive is a required step before current S3', () => {
  const plan = planAt('2026-10-27T00:00:00.000Z');
  const gate = evaluateExpiredSeasonArchives(plan, { 2: { valid: true } });
  assert.equal(plan.expectedSeasonNumber, 3);
  assert.equal(plan.expectedSeasonStart.toISOString(), '2026-10-23T15:00:00.000Z');
  assert.deepEqual(gate.missedSeasons, [2]);
  assert.equal(gate.ready, true);
});

test('a valid S2 archive allows preparing only the immediate S2 target during S3 date catch-up', () => {
  const plan = planAt('2026-11-03T00:00:00.000Z');
  const gate = evaluateExpiredSeasonArchives(plan, { 2: { valid: true } });
  assert.equal(plan.expectedSeasonNumber, 3);
  assert.equal(gate.ready, true);
  assert.equal(canPrepareImmediateCatchUpTarget(1, 2, gate.ready), true);
  assert.equal(canPrepareImmediateCatchUpTarget(1, 3, gate.ready), false);
  assert.equal(canPrepareImmediateCatchUpTarget(1, 2, false), false);
});

test('multiple missed seasons are reported in chronological order and all require archives', () => {
  const plan = planAt('2026-11-27T15:00:00.000Z');
  assert.equal(plan.expectedSeasonNumber, 5);
  assert.deepEqual(plan.completedSeasons, [1, 2, 3, 4]);
  const missing = evaluateExpiredSeasonArchives(plan, { 2: { valid: true }, 4: { valid: true } });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.invalidSeasons, [3]);
  const complete = evaluateExpiredSeasonArchives(plan, { 2: { valid: true }, 3: { valid: true }, 4: { valid: true } });
  assert.equal(complete.ready, true);
});

test('rechecking an already prepared current schedule is deterministic and read-only', () => {
  const plan = planAt('2026-10-27T00:00:00.000Z');
  const archives = { 2: { valid: true } };
  const before = structuredClone(archives);
  const first = evaluateExpiredSeasonArchives(plan, archives);
  const repeated = evaluateExpiredSeasonArchives(plan, archives);
  assert.deepEqual(repeated, first);
  assert.deepEqual(archives, before);
  assert.equal(first.writesStarted, false);
});

test('an incomplete or preparing archive cannot satisfy a completed season boundary', () => {
  const plan = planAt('2026-10-27T00:00:00.000Z');
  const gate = evaluateExpiredSeasonArchives(plan, { 2: { valid: false, reason: 'ARCHIVE_INVALID' } });
  assert.equal(gate.ready, false);
  assert.equal(gate.reason, 'MISSED_SEASON_ARCHIVE_INVALID');
  assert.deepEqual(gate.invalidSeasons, [2]);
});

test('duplicate archived fixtures or slot conflicts block date catch-up', () => {
  const plan = planAt('2026-10-27T00:00:00.000Z');
  const duplicateMatches = evaluateExpiredSeasonArchives(plan, { 2: { valid: true, duplicateMatches: 1 } });
  const slotConflict = evaluateExpiredSeasonArchives(plan, { 2: { valid: true, slotConflicts: 1 } });
  assert.equal(duplicateMatches.ready, false);
  assert.equal(slotConflict.ready, false);
  assert.equal(duplicateMatches.reason, 'MISSED_SEASON_INTEGRITY_CONFLICT');
  assert.equal(slotConflict.reason, 'MISSED_SEASON_INTEGRITY_CONFLICT');
});

test('saved completed-season outcomes are only inspected; the gate never mutates or replaces them', () => {
  const plan = planAt('2026-10-27T00:00:00.000Z');
  const archiveState = { 2: { valid: true } };
  const snapshot = structuredClone(archiveState);
  const gate = evaluateExpiredSeasonArchives(plan, archiveState);
  assert.equal(gate.writesStarted, false);
  assert.deepEqual(archiveState, snapshot);
});

test('two concurrent decisions do not alter archive inputs; publication lock remains the write fence', async () => {
  const plan = planAt('2026-10-27T00:00:00.000Z');
  const archiveStates = { 2: { valid: true } };
  const [first, second] = await Promise.all([
    Promise.resolve().then(() => evaluateExpiredSeasonArchives(plan, archiveStates)),
    Promise.resolve().then(() => evaluateExpiredSeasonArchives(plan, archiveStates)),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(archiveStates, { 2: { valid: true } });
});

test('before the configured next boundary the prior season remains active', () => {
  const plan = planAt('2026-10-08T14:59:59.999Z');
  assert.equal(plan.expectedSeasonNumber, 1);
  assert.equal(plan.expectedNextSeasonStart.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.deepEqual(plan.completedSeasons, []);
});

test('the exact UTC boundary belongs to the new season (half-open calendar intervals)', () => {
  const s2 = planAt('2026-10-08T15:00:00.000Z');
  const s3 = planAt('2026-10-23T15:00:00.000Z');
  assert.equal(s2.expectedSeasonNumber, 2);
  assert.equal(s2.expectedSeasonStart.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(s3.expectedSeasonNumber, 3);
  assert.equal(s3.expectedSeasonStart.toISOString(), '2026-10-23T15:00:00.000Z');
});
