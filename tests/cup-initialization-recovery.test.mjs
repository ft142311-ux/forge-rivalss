import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup document and all preliminary fixtures are committed atomically', () => {
  const start = source.indexOf('export async function generatePyramidCup');
  const end = source.indexOf('async function loadCup', start);
  assert.ok(start >= 0 && end > start);
  const generation = source.slice(start, end);
  const firstFixtureWrite = generation.indexOf('batch.set(');
  const cupCreate = generation.indexOf('batch.create(ref');
  const commit = generation.indexOf('await batch.commit()');
  assert.ok(firstFixtureWrite >= 0 && cupCreate > firstFixtureWrite);
  assert.ok(commit > cupCreate);
  assert.doesNotMatch(generation, /await ref\.create\(/);
  assert.doesNotMatch(generation, /await ref\.update\(/);
});

test('interrupted cup initialization recreates only missing fixtures and preserves legacy matches', () => {
  const start = source.indexOf('async function repairCurrentRoundFixtures');
  const end = source.indexOf('export async function runPyramidCupCycle', start);
  assert.ok(start >= 0 && end > start);
  const recovery = source.slice(start, end);
  assert.match(recovery, /db\.runTransaction\(async \(tx: any\) =>/);
  assert.match(recovery, /tx\.get\(entry\.dedicatedRef\)/);
  assert.match(recovery, /tx\.get\(entry\.legacyRef\)/);
  assert.match(recovery, /snapshots\[index\]\.dedicated\.exists \|\| snapshots\[index\]\.legacy\.exists/);
  assert.match(recovery, /tx\.create\(entry\.dedicatedRef/);
  assert.match(recovery, /pairing\.matchId !== expectedId/);
});

test('Pyramid Cup cycle repairs fixtures before attempting to resolve the current round', () => {
  const start = source.indexOf('export async function runPyramidCupCycle');
  const cycle = source.slice(start);
  const repair = cycle.indexOf('repairCurrentRoundFixtures(db, cup)');
  const round = cycle.indexOf('const round = Number(cup.data.currentRound || 1)');
  assert.ok(repair >= 0 && round > repair);
});

test('Pyramid Cup uses the active season config instead of the hard-coded global calendar', () => {
  const contextStart = source.indexOf('async function readActiveCupSeasonContext');
  const contextEnd = source.indexOf('function cupId', contextStart);
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  const context = source.slice(contextStart, contextEnd);
  assert.match(context, /collection\('system_v1'\)\.doc\('season_config'\)/);
  assert.match(context, /config\.activeSeasonNumber/);
  assert.match(context, /config\.seasonStart/);
  assert.match(context, /config\.nextSeasonStart/);
  assert.match(context, /resolveSeasonLifecycleWindow\(/);
  assert.match(context, /lifecycle\.leagueMatchesPaused/);
  assert.match(context, /config\.worldReady !== true/);
  assert.match(context, /\['REGULAR_SEASON', 'ACTIVE'\]/);
  assert.match(context, /Math\.floor\(\(nowMs - seasonStart\.getTime\(\)\) \/ 86400000\) \+ 1/);
  assert.doesNotMatch(source, /getGlobalSeasonInfo|GLOBAL_EPOCH_ISO|FIRST_SEASON_NEXT_START_ISO/);
});

test('Pyramid Cup generation refuses to target a season other than the active world', () => {
  const start = source.indexOf('export async function generatePyramidCup');
  const end = source.indexOf('async function loadCup', start);
  const generation = source.slice(start, end);
  assert.match(generation, /readActiveCupSeasonContext\(db\)/);
  assert.match(generation, /season !== context\.season/);
  assert.match(generation, /CUP_TARGET_SEASON_NOT_ACTIVE/);
  assert.match(generation, /const seasonStart = context\.seasonStart/);
});
