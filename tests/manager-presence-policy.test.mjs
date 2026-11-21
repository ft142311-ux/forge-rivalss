import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ONLINE_WINDOW_MS, isManagerOnline } = require('../functions/manager-presence-policy.js');

const NOW = Date.parse('2026-11-21T15:00:00.000Z');

test('considers a manager online inside the heartbeat window', () => {
  assert.equal(isManagerOnline(NOW - 45_000, NOW), true);
});

test('keeps the exact two-minute boundary online', () => {
  assert.equal(isManagerOnline(NOW - ONLINE_WINDOW_MS, NOW), true);
});

test('marks a manager offline after the heartbeat window expires', () => {
  assert.equal(isManagerOnline(NOW - ONLINE_WINDOW_MS - 1, NOW), false);
});

test('fails closed for missing or malformed presence timestamps', () => {
  for (const value of [undefined, null, '', 'not-a-date', NaN, {}, { toDate: () => 'invalid' }]) {
    assert.equal(isManagerOnline(value, NOW), false);
  }
});

test('fails closed for future timestamps', () => {
  assert.equal(isManagerOnline(NOW + 1, NOW), false);
});

test('accepts Date, ISO string, and Firestore Timestamp-like values', () => {
  const seenAt = NOW - 1_000;
  assert.equal(isManagerOnline(new Date(seenAt), NOW), true);
  assert.equal(isManagerOnline(new Date(seenAt).toISOString(), NOW), true);
  assert.equal(isManagerOnline({ toMillis: () => seenAt }, NOW), true);
  assert.equal(isManagerOnline({ toDate: () => new Date(seenAt) }, NOW), true);
});
