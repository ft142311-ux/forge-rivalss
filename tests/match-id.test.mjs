import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchDocumentId } from '../src/app/lib/match-id.ts';

test('shared match ID validation accepts ordinary Firestore document IDs', () => {
  assert.doesNotThrow(() => assertMatchDocumentId('match_123'));
  assert.doesNotThrow(() => assertMatchDocumentId('match with spaces'));
});

test('shared match ID validation rejects empty, oversized, and path-sensitive IDs', () => {
  for (const value of ['', '   ', 'x'.repeat(181), 'a/b', 'a#b', 'a?b', 'a[b', 'a]b']) {
    assert.throws(() => assertMatchDocumentId(value), { message: 'INVALID_MATCH_ID' });
  }
});

test('friendly-match validation preserves its historical backslash allowance', () => {
  assert.doesNotThrow(() => assertMatchDocumentId('friendly\\match'));
});

test('universal-match validation continues to reject backslashes', () => {
  assert.throws(
    () => assertMatchDocumentId('universal\\match', { rejectBackslash: true }),
    { message: 'INVALID_MATCH_ID' },
  );
});

test('validation rejects non-string IDs at runtime', () => {
  for (const value of [null, undefined, 123, {}, []]) {
    assert.throws(() => assertMatchDocumentId(value), { message: 'INVALID_MATCH_ID' });
  }
});
