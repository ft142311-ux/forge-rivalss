import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { INACTIVITY_WINDOW_MS, resolveClubInactivity } = require('../functions/club-inactivity-policy.js');

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

test('keeps a club when the last successful sign-in was less than 90 days ago', () => {
  const result = resolveClubInactivity(NOW - INACTIVITY_WINDOW_MS + 1, NOW);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'USER_RECENTLY_ACTIVE');
});

test('marks a club eligible at the exact 90-day boundary', () => {
  const result = resolveClubInactivity(NOW - INACTIVITY_WINDOW_MS, NOW);
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'INACTIVE_OVER_THRESHOLD');
  assert.equal(result.inactiveSince, new Date(NOW - INACTIVITY_WINDOW_MS).toISOString());
});

test('marks a club eligible after more than 90 days', () => {
  assert.equal(resolveClubInactivity(NOW - INACTIVITY_WINDOW_MS - 1, NOW).eligible, true);
});

test('fails closed when last sign-in metadata is missing or malformed', () => {
  for (const value of [undefined, null, '', 'not-a-date', NaN]) {
    const result = resolveClubInactivity(value, NOW);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'LAST_SIGN_IN_UNKNOWN');
  }
});

test('fails closed for a future last sign-in timestamp', () => {
  const result = resolveClubInactivity(NOW + 1, NOW);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'LAST_SIGN_IN_IN_FUTURE');
});

test('accepts Firebase Auth lastSignInTime ISO strings and Date values', () => {
  const expected = NOW - INACTIVITY_WINDOW_MS;
  assert.equal(resolveClubInactivity(new Date(expected), NOW).eligible, true);
  assert.equal(resolveClubInactivity(new Date(expected).toISOString(), NOW).eligible, true);
});
