import test from 'node:test';
import assert from 'node:assert/strict';
import { timestampToMillis } from '../src/app/lib/timestamp-utils.ts';

test('timestampToMillis supports JavaScript date values', () => {
  const expected = Date.parse('2026-11-07T12:00:00.000Z');
  assert.equal(timestampToMillis(new Date(expected)), expected);
  assert.equal(timestampToMillis(expected), expected);
  assert.equal(timestampToMillis('2026-11-07T12:00:00.000Z'), expected);
});

test('timestampToMillis supports Firestore timestamp values', () => {
  const expected = 1_799_999_999_123;
  assert.equal(timestampToMillis({ toMillis: () => expected }), expected);
  assert.equal(timestampToMillis({ toDate: () => new Date(expected) }), expected);
});

test('timestampToMillis supports serialized Firestore timestamp shapes', () => {
  assert.equal(timestampToMillis({ seconds: 1_000, nanoseconds: 500_000_000 }), 1_000_500);
  assert.equal(timestampToMillis({ _seconds: 1_000, _nanoseconds: 500_000_000 }), 1_000_500);
});

test('timestampToMillis returns NaN for invalid or unsupported values', () => {
  assert.equal(timestampToMillis(null), Number.NaN);
  assert.equal(timestampToMillis(undefined), Number.NaN);
  assert.equal(timestampToMillis('not-a-date'), Number.NaN);
  assert.equal(timestampToMillis({ toMillis: () => Number.NaN }), Number.NaN);
  assert.equal(timestampToMillis({ toDate: () => 'not-a-date' }), Number.NaN);
});

test('timestampToMillis supports legacy Firestore timestamp values used by match scheduling', () => {
  assert.equal(timestampToMillis({ _seconds: 1_700_000_000 }), 1_700_000_000_000);
  assert.equal(timestampToMillis({ _seconds: 1_000, _nanoseconds: '250000000' }), 1_000_250);
});
