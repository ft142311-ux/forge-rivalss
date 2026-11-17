import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrainingFinishTimeMs } from '../src/app/lib/player-training-guards.ts';

test('training deadline parser accepts ISO strings, numbers, Dates and Firestore-like timestamps', () => {
  const expected = Date.parse('2026-11-17T12:00:00.000Z');
  assert.equal(resolveTrainingFinishTimeMs('2026-11-17T12:00:00.000Z'), expected);
  assert.equal(resolveTrainingFinishTimeMs(expected), expected);
  assert.equal(resolveTrainingFinishTimeMs(new Date(expected)), expected);
  assert.equal(resolveTrainingFinishTimeMs({ toMillis: () => expected }), expected);
});

test('malformed or missing training deadlines fail closed', () => {
  for (const value of [undefined, null, '', 'not-a-date', NaN, Infinity, {}, { toMillis: () => NaN }]) {
    assert.equal(resolveTrainingFinishTimeMs(value), null);
  }
});

test('training deadline readiness is based on a finite timestamp', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const deadline = resolveTrainingFinishTimeMs('2026-11-17T11:59:59.000Z');
  const future = resolveTrainingFinishTimeMs('2026-11-17T12:00:01.000Z');
  assert.equal(deadline !== null && deadline <= now, true);
  assert.equal(future !== null && future <= now, false);
});
