import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCupPrizeReplayAmount } from '../src/app/lib/cup-prize-ledger.ts';

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
