import test from 'node:test';
import assert from 'node:assert/strict';
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
  const finalize = source.indexOf("if (beforeFinalizeSnap.exists && (beforeFinalizeSnap.data() || {}).phase === 'FINALIZING')");
  const rollover = source.indexOf('prepareSeasonRollover(db, activeSeason, activeSeason + 1)', finalize);
  const blocked = source.indexOf("action: 'WAITING_FOR_SEASON_RESULTS'", rollover);
  const transaction = source.indexOf('const result = await db.runTransaction', finalize);
  assert.ok(finalize >= 0 && rollover > finalize && blocked > rollover && transaction > blocked);
});
