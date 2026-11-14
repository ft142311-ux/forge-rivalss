import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSeasonAwardAlreadyApplied,
  resolveSeasonAwardRecipientState,
  isRolloverPlanPublicationReady,
  shouldPersistSeasonTrophies,
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

test('player reward marker prevents a duplicate payment', () => {
  assert.equal(resolveSeasonAwardRecipientState(true, false, { seasonAwards: { S2: { prize: 100 } } }, 2), 'ALREADY_APPLIED');
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
