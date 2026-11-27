import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCupPrizeBalance, resolveCupPrizeReplayAmount, resolveCupPrizeTrophyState } from '../src/app/lib/cup-prize-ledger.ts';

const expected = {
  userId: 'human-club-1',
  amount: 400_000,
  currency: 'credits',
  type: 'PYRAMID_CUP_CHAMPION_REWARD',
  referenceId: 'cup_s1_lALPHA',
  division: 1,
};
const receipt = { ...expected, balanceBefore: 100_000, balanceAfter: 500_000 };

test('matching Cup reward receipt replay returns the original credited amount', () => {
  assert.equal(resolveCupPrizeReplayAmount(receipt, expected), 400_000);
});

test('Cup reward receipt replay rejects mismatched identity, amount, currency, type, reference or division', () => {
  for (const patch of [
    { userId: 'another-club' },
    { amount: 399_999 },
    { currency: 'gems' },
    { type: 'PYRAMID_CUP_FINALIST_REWARD' },
    { referenceId: 'cup_s2_lALPHA' },
    { division: 2 },
  ]) {
    assert.equal(resolveCupPrizeReplayAmount({ ...receipt, ...patch }, expected), null);
  }
  assert.equal(resolveCupPrizeReplayAmount(null, expected), null);
  assert.equal(resolveCupPrizeReplayAmount(receipt, { ...expected, amount: 0 }), null);
});

test('Cup prize settlement uses the replay amount instead of recording a false zero on retry', () => {
  const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const settlement = source.slice(start, end);
  assert.match(settlement, /resolveCupPrizeReplayAmount\(receipt/);
  assert.match(settlement, /return replayAmount/);
});


test('Cup prize balance accepts canonical legacy integer strings and absent zero balances without allowing overflow', () => {
  assert.deepEqual(resolveCupPrizeBalance(100_000, 35_000), {
    balanceBefore: 100_000,
    balanceAfter: 135_000,
  });
  assert.deepEqual(resolveCupPrizeBalance('100000', 35_000), {
    balanceBefore: 100_000,
    balanceAfter: 135_000,
  });
  assert.deepEqual(resolveCupPrizeBalance(' 100000 ', 35_000), {
    balanceBefore: 100_000,
    balanceAfter: 135_000,
  });
  assert.deepEqual(resolveCupPrizeBalance(undefined, 35_000), {
    balanceBefore: 0,
    balanceAfter: 35_000,
  });
  assert.deepEqual(resolveCupPrizeBalance(null, 35_000), {
    balanceBefore: 0,
    balanceAfter: 35_000,
  });

  for (const invalidBalance of ['', '   ', 'not-a-number', '1.5', '-1', Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, true, {}]) {
    assert.equal(resolveCupPrizeBalance(invalidBalance, 35_000), null);
  }

  assert.equal(resolveCupPrizeBalance(Number.MAX_SAFE_INTEGER, 35_000), null);
  assert.equal(resolveCupPrizeBalance(100_000, 0), null);
  assert.equal(resolveCupPrizeBalance(100_000, Number.MAX_SAFE_INTEGER), null);
});

test('Cup champion trophy state accepts legacy empty collections and detects an existing season trophy', () => {
  assert.deepEqual(resolveCupPrizeTrophyState(undefined, 1), {
    existingTrophies: [],
    hasChampionTrophy: false,
  });
  const existing = [{ id: 'other-trophy' }, { id: 'pyramid-cup-season-2' }];
  assert.deepEqual(resolveCupPrizeTrophyState(existing, 2), {
    existingTrophies: existing,
    hasChampionTrophy: true,
  });
  assert.equal(resolveCupPrizeTrophyState({}, 1), null);
  assert.equal(resolveCupPrizeTrophyState('invalid', 1), null);
  assert.equal(resolveCupPrizeTrophyState([], 0), null);
  assert.equal(resolveCupPrizeTrophyState([], 1.5), null);
});

test('Cup prize settlement refuses malformed balances and trophy collections instead of overwriting them', () => {
  const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const settlement = source.slice(start, end);

  assert.match(settlement, /resolveCupPrizeBalance\(player\.credits, amount\)/);
  assert.match(settlement, /resolveCupPrizeTrophyState\(player\.trophies, season\)/);
  assert.match(settlement, /CUP_PRIZE_RECIPIENT_BALANCE_INVALID/);
  assert.match(settlement, /CUP_PRIZE_TROPHY_COLLECTION_INVALID/);
  assert.match(settlement, /credits: balance\.balanceAfter/);
  assert.match(settlement, /balanceBefore: balance\.balanceBefore, balanceAfter: balance\.balanceAfter/);
});
