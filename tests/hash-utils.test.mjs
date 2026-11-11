import test from 'node:test';
import assert from 'node:assert/strict';
import { hash32 } from '../src/app/lib/hash-utils.ts';

test('hash32 matches the existing FNV-1a 32-bit output', () => {
  assert.equal(hash32(''), 2166136261);
  assert.equal(hash32('a'), 3826002220);
  assert.equal(hash32('hello'), 1335831723);
});

test('hash32 is deterministic and distinguishes different input strings', () => {
  assert.equal(hash32('Forge-Rivals:S1:G1'), hash32('Forge-Rivals:S1:G1'));
  assert.notEqual(hash32('Forge-Rivals:S1:G1'), hash32('Forge-Rivals:S1:G2'));
});

test('hash32 preserves the normalized deterministic value used by gameplay actions', () => {
  const normalized = (value) => hash32(value) / 4294967296;
  assert.equal(normalized('match-1:player-1:discipline'), 0.5646371652837843);
});
