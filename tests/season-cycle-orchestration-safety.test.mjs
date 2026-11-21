import test from 'node:test';
import assert from 'node:assert/strict';
import { isSeasonOrchestratorSuccessful, cronResultStatus } from '../src/app/api/cron/cron-result.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(import.meta.dirname, '../src/app/actions/season-cycle.ts'),
  'utf8',
);

test('offseason freezes unfinished league matches before any catch-up resolver call', () => {
  const pause = source.indexOf('if (retryLifecycle.leagueMatchesPaused)');
  const catchUp = source.indexOf('catchUp = await resolveDailyMatches();', pause);
  assert.notEqual(pause, -1, 'offseason pause guard must exist');
  assert.notEqual(catchUp, -1, 'pre-offseason catch-up path must remain available');
  const pauseBlock = source.slice(pause, catchUp);
  assert.match(pauseBlock, /OFFSEASON_LEAGUE_MATCHES_DISABLED/);
  assert.doesNotMatch(pauseBlock, /resolveDailyMatches\s*\(/);
});

test('prepared season is published before activation and activation ends the scheduler tick', () => {
  const prepared = source.indexOf("if (world?.prepared === true)");
  const publish = source.indexOf('publishPreparedSeason()', prepared);
  const activate = source.indexOf('activatePublishedSeason()', prepared);
  const activatedReturn = source.indexOf("action: 'SEASON_ACTIVATED'", activate);
  const postActivationCatchUp = source.indexOf('catchUp = await resolveDailyMatches();', activate);
  assert.ok(prepared >= 0 && publish > prepared && activate > publish);
  assert.ok(activatedReturn > activate);
  assert.ok(postActivationCatchUp === -1 || postActivationCatchUp > source.indexOf('return {', activatedReturn));
});

test('season finalization requires a ready rollover before lifecycle phase can advance', () => {
  const finalize = source.indexOf("if (beforeFinalizeSnap.exists && (beforeFinalizeSnap.data() || {}).phase === 'FINALIZING'");
  const rollover = source.indexOf('prepareSeasonRollover(db, activeSeason, activeSeason + 1)', finalize);
  const blocked = source.indexOf("action: 'WAITING_FOR_SEASON_RESULTS'", rollover);
  const transaction = source.indexOf('const result = await db.runTransaction', finalize);
  assert.ok(finalize >= 0 && rollover > finalize && blocked > rollover && transaction > blocked);
});


test('season orchestrator cron entry is bearer-protected and delegates to the lifecycle orchestrator', () => {
  const route = readFileSync(
    resolve(import.meta.dirname, '../src/app/api/cron/season-orchestrator/route.ts'),
    'utf8',
  );
  assert.match(route, /isCronAuthorized\(request\)/);
  assert.match(route, /runSeasonOrchestrator\(\)/);
  assert.match(route, /maxDuration\s*=\s*300/);
  assert.match(route, /cronResultStatus\(response\)/);
  const unauthorized = route.indexOf("return new NextResponse('Unauthorized', { status: 401 })");
  const orchestrator = route.indexOf('runSeasonOrchestrator()');
  assert.ok(unauthorized >= 0 && orchestrator > unauthorized, 'unauthorized requests must be rejected before lifecycle writes can start');
  assert.match(route, /isSeasonOrchestratorSuccessful\(result\)/);
});

test('season cron reports blocked activation and incomplete lifecycle results as failures', () => {
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'SEASON_ACTIVATED', worldReady: true, activation: { success: true } }), true);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'ACTIVATION_BLOCKED', worldReady: true, activation: { success: false } }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'SEASON_ACTIVATED', worldReady: true, activation: { success: false } }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'SEASON_ACTIVATED', worldReady: true, activation: { success: true, historyCleanup: { pending: true } } }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'SEASON_ACTIVATED', worldReady: true, activation: { success: true, historyCleanup: { pending: false } } }), true);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'WAITING_FOR_SEASON_RESULTS', worldReady: true }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'IDLE', worldReady: true, tournaments: { success: false, error: 'UNAUTHORIZED' } }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'IDLE', worldReady: true, tournaments: { generated: 0, resolved: 0 } }), true);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'SEASON_PUBLISHED_WAITING_ACTIVATION', worldReady: true }), true);
  assert.equal(cronResultStatus({ success: true }), 200);
  assert.equal(cronResultStatus({ success: false }), 409);
});

test('season cron accepts every documented non-blocking orchestrator action', () => {
  for (const action of [
    'SEASON_ACTIVATED',
    'SEASON_PUBLISHED_WAITING_ACTIVATION',
    'START_FINALIZATION',
    'RESOLVE_MATCHES',
    'GENERATE_NEXT',
    'IDLE',
  ]) {
    assert.equal(
      isSeasonOrchestratorSuccessful({ action, worldReady: true }),
      true,
      `expected ${action} to be a successful scheduler outcome`,
    );
  }
});

test('season cron fails closed for unknown actions or missing active-world readiness', () => {
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'UNKNOWN_ACTION', worldReady: true }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ action: 'IDLE' }), false);
  assert.equal(isSeasonOrchestratorSuccessful({ worldReady: true }), false);
});

test('scheduled season orchestrator runs Pyramid Cup alongside the daily tournament cycle', () => {
  assert.match(source, /import \{ preparePyramidCupForSeason, runPyramidCupCycle \} from '\.\/cup-engine'/);
  assert.match(source, /const \[tournaments, pyramidCup\] = await Promise\.all\(\[/);
  assert.match(source, /runPyramidCupCycle\(\)/);
  assert.match(source, /pyramidCup,/);
});

test('season cron reports Pyramid Cup failures instead of accepting a partial scheduler tick', () => {
  assert.equal(isSeasonOrchestratorSuccessful({
    action: 'IDLE', worldReady: true,
    tournaments: { generated: 0, resolved: 0 },
    pyramidCup: { success: false, error: 'CUP_FIXTURE_FAILED' },
  }), false);
});


test('disposable Season 1 rollover diagnostics are restricted to the local demo emulator', () => {
  const route = readFileSync(
    resolve(import.meta.dirname, '../src/app/api/cron/diagnose-test-season-rollover/route.ts'),
    'utf8',
  );
  const guard = route.indexOf("action: 'LOCAL_EMULATOR_ONLY'");
  const database = route.indexOf('const db = getAdminDb()');
  assert.ok(guard >= 0 && database > guard, 'non-emulator requests must be rejected before Firestore is accessed');
  assert.match(route, /FIRESTORE_EMULATOR_HOST/);
  assert.match(route, /projectId !== 'demo-forge-rivals'/);
  assert.match(route, /writesStarted: false/);
});


test('prepared season Pyramid Cup is generated and verified before publication or activation', () => {
  assert.match(source, /import \{ preparePyramidCupForSeason, runPyramidCupCycle \} from '\.\/cup-engine'/);
  const prepared = source.indexOf("if (world?.prepared === true)");
  const cupPreparation = source.indexOf('preparePyramidCupForSeason(Number(world.seasonNumber))', prepared);
  const publication = source.indexOf('publishPreparedSeason()', prepared);
  const activation = source.indexOf('activatePublishedSeason()', prepared);
  assert.ok(prepared >= 0 && cupPreparation > prepared);
  assert.ok(publication > cupPreparation && activation > publication);
  const gate = source.slice(cupPreparation, publication);
  assert.match(gate, /pyramidCupPreparation\?\.success !== true/);
  assert.match(gate, /PYRAMID_CUP_PREPARATION_BLOCKED/);
  assert.doesNotMatch(gate, /publishPreparedSeason\(\)/);
});

test('Pyramid Cup preparation failure blocks next-season publication without switching the active season', () => {
  const prepared = source.indexOf("if (world?.prepared === true)");
  const cupPreparation = source.indexOf('preparePyramidCupForSeason(Number(world.seasonNumber))', prepared);
  const publication = source.indexOf('publishPreparedSeason()', prepared);
  const gate = source.slice(cupPreparation, publication);
  assert.match(gate, /return \{/);
  assert.match(gate, /action: 'PYRAMID_CUP_PREPARATION_BLOCKED'/);
  assert.match(gate, /targetSeason: Number\(world\.seasonNumber\)/);
  assert.match(gate, /pyramidCup: pyramidCupPreparation/);
});
