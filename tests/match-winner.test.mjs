import test from 'node:test';
import assert from 'node:assert/strict';
import { getMatchWinnerId } from '../src/app/lib/match-winner.ts';

test('match winner IDs retain their original type and value', () => {
  assert.equal(getMatchWinnerId('home', 'home-id', 'away-id'), 'home-id');
  assert.equal(getMatchWinnerId('away', 'home-id', 'away-id'), 'away-id');
  assert.equal(getMatchWinnerId('home', 12, 34), 12);
  assert.equal(getMatchWinnerId('away', 12, 34), 34);
});

test('draws and unknown sides have no winner', () => {
  for (const side of ['draw', 'tie', '', undefined, null]) {
    assert.equal(getMatchWinnerId(side, 'home-id', 'away-id'), null);
  }
});

test('callers can preserve legacy null fallback and string coercion', () => {
  assert.equal(getMatchWinnerId('home', undefined || null, 'away-id'), null);
  assert.equal(getMatchWinnerId('away', String(42), String(99)), '99');
});
