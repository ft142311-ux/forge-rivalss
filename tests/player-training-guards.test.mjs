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
import { readFileSync } from 'node:fs';

test('training completion validates both deadline and canonical skill before applying progress', () => {
  const source = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');
  const completion = source.slice(
    source.indexOf('export async function completePlayerTrainingAction'),
    source.indexOf('export async function recalculateTeamSynergyAction'),
  );
  assert.match(completion, /resolveTrainingFinishTimeMs\(player\.dailyTrainingFinishTime\)/);
  assert.match(completion, /if \(finishAtMs === null\) throw new Error\('TRAINING_FINISH_TIME_INVALID'\)/);
  assert.match(completion, /if \(finishAtMs > Date\.now\(\)\) throw new Error\('TRAINING_NOT_READY'\)/);
  assert.match(completion, /if \(!isFoundationSkill\(focus\)\) throw new Error\('INVALID_TRAINING_SKILL'\)/);
  assert.ok(completion.indexOf('isFoundationSkill(focus)') < completion.indexOf('applyTraining(player, focus'));
});
