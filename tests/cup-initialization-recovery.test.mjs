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
  const repair = cycle.indexOf('repairCurrentRoundFixtures(db, cup, activeSeasonStart)');
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

test('Pyramid Cup can be generated from a fully prepared future season before activation', () => {
  const contextStart = source.indexOf('async function readActiveCupSeasonContext');
  const contextEnd = source.indexOf('function cupId', contextStart);
  const context = source.slice(contextStart, contextEnd);
  assert.match(context, /config\.preparedSeasonNumber/);
  assert.match(context, /config\.preparedWorldReady !== true/);
  assert.match(context, /config\.preparedSeasonStart/);
  assert.match(context, /preparedPhase/);
  assert.match(context, /seasonDay: 0, prepared: true/);
  const generationStart = source.indexOf('export async function generatePyramidCup');
  const generationEnd = source.indexOf('export async function preparePyramidCupForSeason', generationStart);
  const generation = source.slice(generationStart, generationEnd);
  assert.match(generation, /readActiveCupSeasonContext\(db, Date\.now\(\), targetSeasonNumber\)/);
  assert.match(generation, /const seasonStart = context\.seasonStart/);
});

test('pre-publication Pyramid Cup preparation verifies all 120 teams, 56 fixtures and 8 byes', () => {
  const start = source.indexOf('export async function preparePyramidCupForSeason');
  const end = source.indexOf('async function loadCup', start);
  assert.ok(start >= 0 && end > start);
  const preparation = source.slice(start, end);
  assert.match(preparation, /context\.prepared !== true/);
  assert.match(preparation, /participants\.length !== TOTAL_TEAMS/);
  assert.match(preparation, /firstRound\.length !== 64/);
  assert.match(preparation, /filter\(\(pairing: any\) => pairing\?\.status === 'bye'\)\.length !== 8/);
  assert.match(preparation, /fixtures\.length !== 56/);
  assert.match(preparation, /CUP_PREPARED_FIXTURES_MISSING/);
  assert.match(preparation, /CUP_PREPARED_FIXTURE_IDENTITY_INVALID/);
});

test('Pyramid Cup preliminary round starts after league Tour 1 and all rounds are daily at 07:00 Moscow time', () => {
  assert.match(source, /const ROUND_DAYS = \[2, 3, 4, 5, 6, 7, 8\]/);
  const start = source.indexOf('function roundDate');
  const end = source.indexOf('function normalizeTeam', start);
  assert.ok(start >= 0 && end > start);
  const schedule = source.slice(start, end);
  assert.match(schedule, /seasonDay < 1/);
  assert.match(schedule, /date\.setUTCHours\(CUP_START_HOUR_UTC, 0, 0, 0\)/);
  assert.match(source, /const CUP_START_HOUR_UTC = 4/);
  assert.match(source, /preliminary round follows league Tour 1/);
});

test('Pyramid Cup ordinary rounds use BO1 and only the final uses BO3', () => {
  const start = source.indexOf('function buildCupRoundMatchData');
  const end = source.indexOf('async function commitCupRoundTransition', start);
  assert.ok(start >= 0 && end > start);
  const builder = source.slice(start, end);
  assert.match(builder, /bestOf: isFinal \? 3 : 1/);
  assert.match(builder, /affectsLeagueStandings: false/);
});

test('legacy activateNextSeason entry point cannot bypass Pyramid Cup or scheduled activation gates', () => {
  const seasonCycleSource = readFileSync(new URL('../src/app/actions/season-cycle.ts', import.meta.url), 'utf8');
  const start = seasonCycleSource.indexOf('export async function activateNextSeason()');
  const end = seasonCycleSource.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  const entryPoint = seasonCycleSource.slice(start, end);
  assert.match(entryPoint, /return runSeasonOrchestrator\(\)/);
  assert.doesNotMatch(entryPoint, /publishPreparedSeason\(|activatePublishedSeason\(/);
});
