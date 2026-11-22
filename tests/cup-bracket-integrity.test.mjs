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
  assert.match(validator, /ROUND_BYE_COUNTS\\[round - 1\\]/);
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

test('Pyramid Cup seeding prioritizes division, then rank and group; stronger seed is away', () => {
  assert.match(source, /return a\.level - b\.level \|\| a\.rank - b\.rank \|\| a\.group - b\.group/);
  assert.match(source, /const eligible = teams\.slice\(8\)/);
  assert.match(source, /for \(let i = 0; i < 56; i\+\+\) pairs\.push\(makePair/);
  assert.match(source, /pairs\.push\(\{ id: `r1_bye_/);
  assert.match(source, /The stronger team is always AWAY; weaker team is HOME/);
  assert.match(source, /teams\[i\], teams\[teams\.length - 1 - i\]/);
});

test('Pyramid Cup BO1 has exactly one decisive game and the final remains BO3', () => {
  const simulation = readFileSync(new URL('../src/app/lib/match-simulation.ts', import.meta.url), 'utf8');
  assert.match(source, /bestOf: isFinal \? 3 : 1/);
  assert.match(simulation, /const totalGames=bestOf===3\?3:bestOf/);
  assert.match(simulation, /if\(g\.winner==='home'\)winsA\+\+;else winsB\+\+/);
  assert.match(simulation, /const winnerSide=winsA>winsB\?'home':winsB>winsA\?'away':'draw'/);
});
