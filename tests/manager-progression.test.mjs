import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGER_XP_REWARDS,
  calculateManagerProgress,
  createManagerXpAward,
  tryCreateManagerXpAward,
  normalizeManagerProgress,
  getManagerMatchXp,
  getManagerProgressDisplay,
  isEligibleManagerProfile,
} from '../src/app/lib/manager-progression.ts';

test('manager progress normalization protects the UI from corrupt legacy values', () => {
  assert.deepEqual(
    normalizeManagerProgress({ managerLevel: 'bad', experiencePoints: -1 }),
    { managerLevel: 1, experiencePoints: 0, valid: false, reason: 'MANAGER_PROGRESS_INVALID' },
  );
  assert.deepEqual(
    normalizeManagerProgress({ managerLevel: '2', experiencePoints: '50' }),
    { managerLevel: 2, experiencePoints: 50, valid: true, reason: null },
  );
});

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

test('safe manager XP awards skip corrupt legacy progress without overwriting it', () => {
  assert.deepEqual(
    tryCreateManagerXpAward({ managerLevel: 0, experiencePoints: 100 }, 25, 'league_match'),
    { award: null, skippedReason: 'MANAGER_PROGRESS_INVALID' },
  );
  assert.deepEqual(
    tryCreateManagerXpAward({ managerLevel: 1, experiencePoints: Number.MAX_SAFE_INTEGER }, 25, 'daily_reward'),
    { award: null, skippedReason: 'MANAGER_XP_OVERFLOW' },
  );
});

test('safe manager XP awards preserve valid receipts and reject invalid reward configuration', () => {
  const profile = { managerLevel: 2, experiencePoints: 1390 };
  const safe = tryCreateManagerXpAward(profile, 20, 'league_match');
  assert.equal(safe.skippedReason, null);
  assert.deepEqual(safe.award, createManagerXpAward(profile, 20, 'league_match'));
  assert.throws(
    () => tryCreateManagerXpAward({ managerLevel: 1, experiencePoints: 0 }, 0, 'league_match'),
    /MANAGER_XP_AMOUNT_INVALID/,
  );
});

test('manager XP reward table follows match-only rewards for league, Cup, tournaments and trials', () => {
  assert.equal('dailyReward' in MANAGER_XP_REWARDS, false);
  assert.equal(getManagerMatchXp('league', false), 50);
  assert.equal(getManagerMatchXp('league', true), 60);
  assert.equal(getManagerMatchXp('pyramid_cup', false), 50);
  assert.equal(getManagerMatchXp('pyramid_cup', true), 60);
  assert.equal(getManagerMatchXp('tournament', false), 20);
  assert.equal(getManagerMatchXp('tournament', true), 30);
  assert.equal(getManagerMatchXp('trial', false), 5);
  assert.equal(getManagerMatchXp('trial', true), 10);
  assert.equal(getManagerMatchXp('association', false), 20);
  assert.equal(getManagerMatchXp('association', true), 30);
  assert.equal(getManagerMatchXp('friendly', false), 10);
  assert.equal(getManagerMatchXp('friendly', true), 15);
});

test('manager level thresholds start at 700 XP and double at every level', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((level) => getManagerProgressDisplay(level, 0).threshold),
    [700, 1400, 2800, 5600, 11200, 22400],
  );
});

test('manager progress display reports current threshold and remaining XP', () => {
  assert.deepEqual(getManagerProgressDisplay(1, 175), {
    managerLevel: 1, experiencePoints: 175, threshold: 700, remaining: 525, percent: 25,
  });
});

test('bot profiles never receive manager XP', () => {
  assert.equal(isEligibleManagerProfile('bot_team_1', { isBot: true }), false);
  assert.equal(isEligibleManagerProfile('manager-1', { isBot: true }), false);
  assert.equal(isEligibleManagerProfile('manager-1', { isHuman: false }), false);
  assert.equal(isEligibleManagerProfile('manager-1', { isBot: false }), true);
});
