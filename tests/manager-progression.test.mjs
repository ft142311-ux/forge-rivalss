import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGER_XP_REWARDS,
  calculateManagerProgress,
  createManagerXpAward,
  getManagerMatchXp,
  getManagerProgressDisplay,
  isEligibleManagerProfile,
} from '../src/app/lib/manager-progression.ts';

test('manager XP consumes the current level threshold and advances exactly at the boundary', () => {
  assert.deepEqual(calculateManagerProgress({ managerLevel: 1, experiencePoints: 699 }, 1), {
    levelBefore: 1, experienceBefore: 699, managerLevel: 2, experiencePoints: 0, levelsGained: 1, amount: 1,
  });
  assert.deepEqual(calculateManagerProgress({ managerLevel: 1, experiencePoints: 698 }, 1), {
    levelBefore: 1, experienceBefore: 698, managerLevel: 1, experiencePoints: 699, levelsGained: 0, amount: 1,
  });
});

test('manager XP can advance multiple levels without losing overflow XP', () => {
  const result = calculateManagerProgress({ managerLevel: 1, experiencePoints: 0 }, 2200);
  assert.equal(result.managerLevel, 3);
  assert.equal(result.experiencePoints, 100);
  assert.equal(result.levelsGained, 2);
});

test('manager XP rejects malformed, negative, fractional and overflowing progress', () => {
  for (const profile of [
    { managerLevel: 0, experiencePoints: 0 },
    { managerLevel: 1.5, experiencePoints: 0 },
    { managerLevel: 1, experiencePoints: -1 },
    { managerLevel: 1, experiencePoints: '   ' },
  ]) {
    assert.throws(() => calculateManagerProgress(profile, 1), /MANAGER_PROGRESS_INVALID/);
  }
  assert.throws(() => calculateManagerProgress({ managerLevel: 1, experiencePoints: 0 }, 0), /MANAGER_XP_AMOUNT_INVALID/);
  assert.throws(() => calculateManagerProgress({ managerLevel: 1, experiencePoints: Number.MAX_SAFE_INTEGER }, 1), /MANAGER_XP_OVERFLOW/);
});

test('manager XP awards retain a complete audit receipt and profile patch', () => {
  const award = createManagerXpAward({ managerLevel: 2, experiencePoints: 1390 }, 20, 'league_match');
  assert.deepEqual(award.profilePatch, { managerLevel: 3, experiencePoints: 10 });
  assert.deepEqual(award.receipt, {
    source: 'league_match',
    amount: 20,
    levelBefore: 2,
    levelAfter: 3,
    xpBefore: 1390,
    xpAfter: 10,
    levelsGained: 1,
  });
});

test('manager XP reward table differentiates daily, league, cup and tournament activity', () => {
  assert.equal(MANAGER_XP_REWARDS.dailyReward, 25);
  assert.equal(getManagerMatchXp('league', false), 100);
  assert.equal(getManagerMatchXp('league', true), 150);
  assert.equal(getManagerMatchXp('pyramid_cup', false), 120);
  assert.equal(getManagerMatchXp('pyramid_cup', true), 180);
  assert.equal(getManagerMatchXp('tournament', false), 75);
  assert.equal(getManagerMatchXp('tournament', true), 115);
});

test('manager progress display reports current threshold and remaining XP', () => {
  assert.deepEqual(getManagerProgressDisplay(1, 350), {
    managerLevel: 1, experiencePoints: 350, threshold: 700, remaining: 350, percent: 50,
  });
});

test('bot profiles never receive manager XP', () => {
  assert.equal(isEligibleManagerProfile('bot_team_1', { isBot: true }), false);
  assert.equal(isEligibleManagerProfile('manager-1', { isBot: true }), false);
  assert.equal(isEligibleManagerProfile('manager-1', { isHuman: false }), false);
  assert.equal(isEligibleManagerProfile('manager-1', { isBot: false }), true);
});
