import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSeasonAwardAlreadyApplied,
  resolveSeasonAwardRecipientState,
  isRolloverPlanPublicationReady,
  shouldPersistSeasonTrophies,
  resolveSeasonAwardBalance,
  resolveSeasonAwardTrophyState,
} from '../src/app/actions/season-awards-policy.ts';

test('season reward idempotency accepts only an unapplied valid season', () => {
  assert.equal(isSeasonAwardAlreadyApplied({}, false, 1), false);
  assert.equal(isSeasonAwardAlreadyApplied({ seasonAwards: { S1: { prize: 100 } } }, false, 1), true);
  assert.equal(isSeasonAwardAlreadyApplied({}, true, 1), true);
  assert.equal(isSeasonAwardAlreadyApplied({}, false, 0), true);
});

test('either independent cup can require persisting the trophy array', () => {
  assert.equal(shouldPersistSeasonTrophies(false, false), false);
  assert.equal(shouldPersistSeasonTrophies(true, false), true);
  assert.equal(shouldPersistSeasonTrophies(false, true), true);
  assert.equal(shouldPersistSeasonTrophies(true, true), true);
});


test('reward recipient state trusts a ledger even when the player profile is gone', () => {
  assert.equal(resolveSeasonAwardRecipientState(false, true, null, 1), 'ALREADY_APPLIED');
});

test('missing player profile without a ledger blocks reward completion', () => {
  assert.equal(resolveSeasonAwardRecipientState(false, false, null, 1), 'PROFILE_MISSING');
});

test('matching player reward and ledger markers prevent a duplicate payment', () => {
  assert.equal(resolveSeasonAwardRecipientState(true, true, { seasonAwards: { S2: { prize: 100 } } }, 2), 'ALREADY_APPLIED');
});

test('existing profile without a marker is ready for its first reward', () => {
  assert.equal(resolveSeasonAwardRecipientState(true, false, {}, 2), 'READY');
});

test('only completed ordinary rewards or explicit recovery plans can be published', () => {
  assert.equal(isRolloverPlanPublicationReady({ ready: true, mode: 'recovery_carry_forward' }), true);
  assert.equal(isRolloverPlanPublicationReady({ ready: true, awards: { ready: true } }), true);
  assert.equal(isRolloverPlanPublicationReady({ ready: true, awards: { ready: false } }), false);
  assert.equal(isRolloverPlanPublicationReady({ ready: true }), false);
});

test('split player award and ledger markers block rollover for manual reconciliation', () => {
  assert.equal(resolveSeasonAwardRecipientState(
    true, false, { seasonAwards: { S3: { prize: 100 } } }, 3,
  ), 'ACCOUNTING_CONFLICT');
  assert.equal(resolveSeasonAwardRecipientState(
    true, true, {}, 3,
  ), 'ACCOUNTING_CONFLICT');
});

test('matching player award and ledger markers are the only consistent already-paid state', () => {
  assert.equal(resolveSeasonAwardRecipientState(
    true, true, { seasonAwards: { S3: { prize: 100 } } }, 3,
  ), 'ALREADY_APPLIED');
});


test('season reward balance accepts legacy integer strings and absent zero but rejects malformed values and overflow', () => {
  assert.deepEqual(resolveSeasonAwardBalance(undefined, 400), { balanceBefore: 0, balanceAfter: 400 });
  assert.deepEqual(resolveSeasonAwardBalance(' 1000 ', 400), { balanceBefore: 1000, balanceAfter: 1400 });
  for (const invalid of ['', 'invalid', '1.5', '-1', Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, true, {}]) {
    assert.equal(resolveSeasonAwardBalance(invalid, 400), null);
  }
  assert.equal(resolveSeasonAwardBalance(Number.MAX_SAFE_INTEGER, 400), null);
  assert.equal(resolveSeasonAwardBalance(1000, 0), null);
});

test('season award trophy validation preserves unrelated trophies and repairs malformed or duplicate season awards', () => {
  const league = {
    id: 'league-cup-season-2',
    name: 'Кубок лиги — сезон 2',
    type: 'league_champion',
    date: '2026-11-27T12:00:00.000Z',
    reward: 5000,
    season: 2,
    division: 1,
    rank: 1,
  };
  const pyramid = {
    id: 'pyramid-cup-season-2',
    name: 'Кубок Пирамиды — сезон 2',
    type: 'pyramid_cup_champion',
    date: '2026-11-27T12:00:00.000Z',
    season: 2,
  };
  const other = { id: 'historic-award', name: 'Historic award' };
  assert.deepEqual(resolveSeasonAwardTrophyState([other, league, pyramid], 2, 5000, true, true), {
    existingTrophies: [other, league, pyramid],
    shouldAddLeagueCup: false,
    shouldAddPyramidCup: false,
    needsRepair: false,
  });

  const malformed = { id: 'league-cup-season-2', name: 'Forged trophy', type: 'other', date: 'invalid' };
  const result = resolveSeasonAwardTrophyState([other, malformed, { ...pyramid }], 2, 5000, true, true);
  assert.deepEqual(result, {
    existingTrophies: [other, pyramid],
    shouldAddLeagueCup: true,
    shouldAddPyramidCup: false,
    needsRepair: true,
  });

  const duplicates = resolveSeasonAwardTrophyState([league, { ...league }], 2, 5000, true, false);
  assert.equal(duplicates?.existingTrophies.length, 1);
  assert.equal(duplicates?.shouldAddLeagueCup, false);
  assert.equal(duplicates?.needsRepair, true);
});

test('season award trophy validation refuses malformed trophy collection instead of replacing it', () => {
  assert.equal(resolveSeasonAwardTrophyState({}, 1, 100, true, false), null);
  assert.equal(resolveSeasonAwardTrophyState('invalid', 1, 100, true, false), null);
  assert.equal(resolveSeasonAwardTrophyState([], 1, 0, true, false), null);
  assert.equal(resolveSeasonAwardTrophyState([], 1.5, 100, true, false), null);
});

test('malformed season award containers and markers block accounting completion', () => {
  assert.equal(resolveSeasonAwardRecipientState(true, false, { seasonAwards: [] }, 4), 'ACCOUNTING_CONFLICT');
  assert.equal(resolveSeasonAwardRecipientState(true, false, { seasonAwards: { S4: 'paid' } }, 4), 'ACCOUNTING_CONFLICT');
});
