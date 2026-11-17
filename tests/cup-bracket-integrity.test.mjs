import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup validates the expected pairing count for every round before resolution', () => {
  const start = source.indexOf('function assertValidCupRoundPairings');
  const end = source.indexOf('export async function runPyramidCupCycle', start);
  assert.ok(start >= 0 && end > start);
  const validator = source.slice(start, end);
  assert.match(validator, /round === 1 \? 64 : Math\.pow\(2, ROUND_COUNT - round\)/);
  assert.match(validator, /CUP_ROUND_PAIRING_COUNT_INVALID/);
  assert.match(validator, /CUP_ROUND_PAIRING_IDENTITY_INVALID/);
  assert.match(validator, /CUP_ROUND_BYE_INVALID/);
  assert.match(validator, /CUP_ROUND_PARTICIPANTS_INVALID/);
  assert.match(validator, /round === 1 && byes !== 8/);
});

test('corrupt or skipped Pyramid Cup rounds fail closed instead of advancing an empty bracket', () => {
  const start = source.indexOf('export async function runPyramidCupCycle');
  const cycle = source.slice(start);
  assert.match(cycle, /round < 1 \|\| round > ROUND_COUNT/);
  const validate = cycle.indexOf('assertValidCupRoundPairings(pairings, round)');
  const resolve = cycle.indexOf('for (const pairing of pairings)');
  assert.ok(validate >= 0 && resolve > validate);
  assert.match(cycle, /CUP_CURRENT_ROUND_INVALID/);
});
