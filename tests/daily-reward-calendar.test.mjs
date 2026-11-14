import test from 'node:test';
import assert from 'node:assert/strict';
import { getMoscowDateString } from '../src/app/lib/time-utils.ts';
import { getDailyRewardForDay } from '../src/app/lib/daily-reward.ts';

test('daily reward date follows the Moscow calendar boundary, not UTC midnight', () => {
  assert.equal(getMoscowDateString(new Date('2026-11-14T20:59:59.999Z')), '2026-11-14');
  assert.equal(getMoscowDateString(new Date('2026-11-14T21:00:00.000Z')), '2026-11-15');
});

test('daily reward schedule is shared and consistent for all 30 days', () => {
  assert.deepEqual(getDailyRewardForDay(1), { day: 1, credits: 150_000, crystals: 10 });
  assert.deepEqual(getDailyRewardForDay(7), { day: 7, credits: 450_000, crystals: 60 });
  assert.deepEqual(getDailyRewardForDay(8), { day: 8, credits: 500_000, crystals: 10 });
  assert.deepEqual(getDailyRewardForDay(30), { day: 30, credits: 1_600_000, crystals: 10 });
  assert.deepEqual(getDailyRewardForDay(0), getDailyRewardForDay(1));
});
