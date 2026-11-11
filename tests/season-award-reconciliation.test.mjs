import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySeasonAwardState } from '../src/app/actions/season-award-reconciliation.ts';

test('classifies award and ledger as consistent', () => {
  assert.equal(classifySeasonAwardState({ prize: 100 }, { amount: 100 }), 'AWARD_AND_LEDGER');
});

test('classifies award without ledger without performing repair', () => {
  assert.equal(classifySeasonAwardState({ prize: 100 }, null), 'AWARD_WITHOUT_LEDGER');
});

test('classifies ledger without award without retrying payout', () => {
  assert.equal(classifySeasonAwardState(null, { amount: 100 }), 'LEDGER_WITHOUT_AWARD');
});

test('classifies absence of both markers', () => {
  assert.equal(classifySeasonAwardState(null, null), 'NEITHER');
});
