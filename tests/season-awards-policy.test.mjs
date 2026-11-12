import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSeasonAwardAlreadyApplied,
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
