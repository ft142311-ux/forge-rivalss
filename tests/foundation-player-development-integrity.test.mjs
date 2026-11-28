import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateSalary } from '../src/game/foundation/player-system.ts';
import { resolveFoundationPlayerSalary } from '../src/game/foundation/economy.ts';
import {
  applyFoundationDailyTrainingBonus,
  readFoundationDailyTrainingBonus,
} from '../src/game/foundation/training.ts';

const cycle = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');
const advanced = readFileSync(new URL('../src/app/actions/foundation-advanced.ts', import.meta.url), 'utf8');
const management = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');

const DAY = '2026-11-28';
const player = (overrides = {}) => ({
  id: 'player-1',
  role: 'Carry',
  currentRole: 'Carry',
  age: 20,
  form: 100,
  fatigue: 100,
  salary: 1200,
  proStats: {},
  proTalents: {},
  ...overrides,
});

function actionBlock(source, name) {
  const start = source.indexOf('export async function ' + name);
  assert.ok(start >= 0, 'missing action ' + name);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('daily player salary keeps canonical values and only recalculates missing legacy values', () => {
  assert.equal(resolveFoundationPlayerSalary(player({ salary: 1200 })), 1200);
  assert.equal(resolveFoundationPlayerSalary(player({ salary: '1250' })), 1250);
  for (const salary of [undefined, null, 0, '0']) {
    assert.equal(
      resolveFoundationPlayerSalary(player({ salary })),
      calculateSalary(player({ salary: undefined })),
    );
  }
});

test('daily player salary rejects corrupt persisted values instead of silently recalculating them', () => {
  for (const salary of ['', ' ', ' 1200', '1200 ', '-1', '1.5', -1, 1.5, true, {}, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => resolveFoundationPlayerSalary(player({ salary })),
      /FOUNDATION_SALARY_INVALID/,
      String(salary),
    );
  }
});

test('daily training bonus is date-scoped, bounded and safely stackable', () => {
  const clean = player();
  assert.equal(readFoundationDailyTrainingBonus(clean, DAY), 0);

  const first = applyFoundationDailyTrainingBonus(clean, 0.1, DAY);
  assert.equal(readFoundationDailyTrainingBonus(first, DAY), 0.1);
  assert.equal(readFoundationDailyTrainingBonus(first, '2026-11-29'), 0);

  const second = applyFoundationDailyTrainingBonus(first, 0.1, DAY);
  assert.equal(readFoundationDailyTrainingBonus(second, DAY), 0.2);
  assert.throws(
    () => applyFoundationDailyTrainingBonus(second, 0.1, DAY),
    /FOUNDATION_TRAINING_BONUS_INVALID/,
  );
});

test('daily training bonus rejects malformed persisted metadata and invalid dates', () => {
  for (const malformed of [
    { dailyTrainingBonus: 0.1 },
    { dailyTrainingBonusDate: DAY },
    { dailyTrainingBonus: -0.1, dailyTrainingBonusDate: DAY },
    { dailyTrainingBonus: 0.26, dailyTrainingBonusDate: DAY },
    { dailyTrainingBonus: '0.1', dailyTrainingBonusDate: DAY },
    { dailyTrainingBonus: 0.1, dailyTrainingBonusDate: ' 2026-11-28' },
  ]) {
    assert.throws(
      () => readFoundationDailyTrainingBonus(player(malformed), DAY),
      /FOUNDATION_TRAINING_BONUS_INVALID/,
    );
  }
});

test('positive-training event bonus is applied to players and consumed by the next same-day training completion', () => {
  const resolver = actionBlock(advanced, 'resolveFoundationEventAction');
  const completion = actionBlock(management, 'completePlayerTrainingAction');

  assert.ok(resolver.includes('const trainingBonus = effects.trainingBonus ?? 0'));
  assert.ok(resolver.includes('applyFoundationDailyTrainingBonus(updated, trainingBonus, period)'));
  assert.ok(completion.includes('readFoundationDailyTrainingBonus(player, periodKey)'));
  assert.ok(completion.includes('Math.round(90 * staffBonus * (1 + eventBonus))'));
  assert.ok(completion.includes('dailyTrainingBonus: 0'));
  assert.ok(completion.includes('dailyTrainingBonusDate: periodKey'));
});

test('daily cycle uses the same strict salary resolver before persisting normalized players', () => {
  const start = cycle.indexOf('function normalizePlayers');
  const end = cycle.indexOf('async function processManager', start);
  const normalize = cycle.slice(start, end);
  assert.ok(normalize.includes('resolveFoundationPlayerSalary(normalized as any)'));
  assert.ok(!normalize.includes('calculateSalary(normalized)'));
});
