import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup validates exact even pairings and zero BYEs in every round', () => {
  const start = source.indexOf('function assertValidCupRoundPairings');
  const end = source.indexOf('export async function runPyramidCupCycle', start);
  assert.ok(start >= 0 && end > start);
  const validator = source.slice(start, end);
  assert.match(validator, /ROUND_PAIRING_COUNTS\[round - 1\]/);
  assert.match(validator, /ROUND_TEAM_COUNTS\[round - 1\]/);
  assert.match(validator, /ROUND_BYE_COUNTS\[round - 1\] !== 0/);
  assert.match(validator, /CUP_ROUND_PAIRING_COUNT_INVALID/);
  assert.match(validator, /CUP_ROUND_PAIRING_IDENTITY_INVALID/);
  assert.match(validator, /CUP_ROUND_PARTICIPANTS_INVALID/);
  assert.doesNotMatch(validator, /pairing\.status === 'bye'/);
});

test('only D2-D4 play the opening round and adjacent weakest seeds are paired', () => {
  assert.match(source, /const ROUND_PAIRING_COUNTS = \[56, 32, 16, 8, 4, 2, 1\]/);
  assert.match(source, /const ROUND_TEAM_COUNTS = \[112, 64, 32, 16, 8, 4, 2\]/);
  assert.match(source, /const ROUND_BYE_COUNTS = \[0, 0, 0, 0, 0, 0, 0\]/);
  assert.match(source, /teams\.filter\(team => team\.level !== 1\)/);
  assert.match(source, /const stronger = eligible\[eligible\.length - 2 - i \* 2\]/);
  assert.match(source, /const weaker = eligible\[eligible\.length - 1 - i \* 2\]/);
  assert.match(source, /openingRoundRestTeams/);
  assert.match(source, /D1_REST_OPENING_ROUND/);
  assert.match(source, /CUP_D1_OPENING_ROUND_REST_COUNT_INVALID/);
  assert.doesNotMatch(source, /r\$\{round\}_bye_/);
});

test('all eight D1 teams join the 56 opening-round winners before round two', () => {
  const start = source.indexOf('const winners: Team[] = []');
  const end = source.indexOf('const nextRound = round + 1', start);
  assert.ok(start >= 0 && end > start);
  const progression = source.slice(start, end);
  assert.match(progression, /if \(round === 1\)/);
  assert.match(progression, /openingRoundRestTeams/);
  assert.match(progression, /team\.level !== 1/);
  assert.match(progression, /winners\.length !== expectedWinners/);
  assert.match(progression, /ROUND_TEAM_COUNTS\[round\]/);
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

test('Pyramid Cup BO1 has exactly one decisive game and the final remains BO3', () => {
  const simulation = readFileSync(new URL('../src/app/lib/match-simulation.ts', import.meta.url), 'utf8');
  assert.match(source, /bestOf: isFinal \? 3 : 1/);
  assert.match(simulation, /const totalGames=bestOf===3\?3:bestOf/);
  assert.match(simulation, /if\(g\.winner==='home'\)winsA\+\+;else winsB\+\+/);
  assert.match(simulation, /const winnerSide=winsA>winsB\?'home':winsB>winsA\?'away':'draw'/);
});
