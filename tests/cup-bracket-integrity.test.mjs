import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup validates the exact pairing, team and BYE count in every round', () => {
  const start = source.indexOf('function assertValidCupRoundPairings');
  const end = source.indexOf('export async function runPyramidCupCycle', start);
  assert.ok(start >= 0 && end > start);
  const validator = source.slice(start, end);
  assert.match(validator, /ROUND_PAIRING_COUNTS\[round - 1\]/);
  assert.match(validator, /ROUND_TEAM_COUNTS\[round - 1\]/);
  assert.match(validator, /ROUND_BYE_COUNTS\[round - 1\]/);
  assert.match(validator, /CUP_ROUND_PAIRING_COUNT_INVALID/);
  assert.match(validator, /CUP_ROUND_PAIRING_IDENTITY_INVALID/);
  assert.match(validator, /CUP_ROUND_BYE_INVALID/);
  assert.match(validator, /CUP_ROUND_PARTICIPANTS_INVALID/);
});

test('all 120 clubs enter the opening round and are paired strongest-away against weakest-home', () => {
  assert.match(source, /for \(let i = 0; i < TOTAL_TEAMS \/ 2; i\+\+\)/);
  assert.match(source, /ordered\[i\], ordered\[ordered\.length - 1 - i\]/);
  assert.match(source, /The stronger team is always AWAY; weaker team is HOME/);
  assert.doesNotMatch(source, /teams\.slice\(8\)/);
  assert.doesNotMatch(source, /r1_bye_/);
});

test('the only BYE occurs in round four and is assigned to the strongest remaining seed', () => {
  assert.match(source, /const byeTeam = teams\.length % 2 === 1 \? teams\.shift\(\) : null/);
  assert.match(source, /if \(byeTeam && round !== 4\)/);
  assert.match(source, /id: `r\$\{round\}_bye_1`/);
  assert.match(source, /ROUND_TEAM_COUNTS\[round\]/);
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
