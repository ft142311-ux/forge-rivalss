import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName } from '../src/app/lib/normalize-name.ts';

test('normalizeName trims surrounding whitespace', () => {
  assert.equal(normalizeName('  Forge Rivals  '), 'Forge Rivals');
});

test('normalizeName preserves the 40-character limit', () => {
  assert.equal(normalizeName('A'.repeat(45)), 'A'.repeat(40));
});

test('normalizeName uses the default fallback for empty or non-string values', () => {
  assert.equal(normalizeName(''), 'Manager');
  assert.equal(normalizeName('   '), 'Manager');
  assert.equal(normalizeName(null), 'Manager');
  assert.equal(normalizeName(123), 'Manager');
});

test('normalizeName preserves a caller-provided fallback', () => {
  assert.equal(normalizeName('', 'Home'), 'Home');
  assert.equal(normalizeName(undefined, 'Away'), 'Away');
});
