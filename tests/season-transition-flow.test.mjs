import test from 'node:test';
import assert from 'node:assert/strict';
import { runSeasonActivationFlow } from '../src/app/actions/season-transition-flow.ts';

test('S1 activation builds S2 and publishes it before accepting its rollover plan', async () => {
  let config = { activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false };
  const calls = [];
  const result = await runSeasonActivationFlow({
    readConfig: async () => { calls.push('read-config'); return config; },
    prepareNextSeason: async (source, target) => {
      calls.push(`build-S${source}-to-S${target}`);
      calls.push(`publish-S${target}`);
      config = { activeSeasonNumber: 2, nextSeasonNumber: 2, phase: 'REGULAR_SEASON', worldReady: true };
      return { success: true, action: 'SEASON_PUBLISHED', sourceSeason: source, targetSeason: target, worldReady: true };
    },
    readRollover: async target => {
      calls.push(`read-plan-S${target}`);
      return { sourceSeason: 1, targetSeason: target, ready: true };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.action, 'SEASON_ACTIVATED');
  assert.deepEqual(calls, ['read-config', 'build-S1-to-S2', 'publish-S2', 'read-config', 'read-plan-S2']);
});

test('a publication error after a successful build does not activate S2', async () => {
  const config = { activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false };
  const result = await runSeasonActivationFlow({
    readConfig: async () => config,
    prepareNextSeason: async () => ({
      success: false,
      action: 'WORLD_NOT_READY',
      reason: 'PUBLICATION_STATE_CHANGED',
      build: { success: true, prepared: true },
    }),
    readRollover: async () => { throw new Error('publication failure must not read the activation plan'); },
  });

  assert.equal(result.success, false);
  assert.equal(result.preparation.reason, 'PUBLICATION_STATE_CHANGED');
  assert.equal(config.activeSeasonNumber, 1);
  assert.equal(config.worldReady, false);
});

test('repeated activation verifies the prepared season without preparing it again', async () => {
  const calls = [];
  const result = await runSeasonActivationFlow({
    readConfig: async () => ({ activeSeasonNumber: 2, nextSeasonNumber: 2, worldReady: true }),
    prepareNextSeason: async () => { calls.push('prepare'); return { success: true }; },
    readRollover: async target => { calls.push(`read-plan-S${target}`); return { ready: true, targetSeason: 2 }; },
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, ['read-plan-S2']);
});

test('incomplete preparation stops before the activation and rollover gates', async () => {
  const calls = [];
  const result = await runSeasonActivationFlow({
    readConfig: async () => ({ activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false }),
    prepareNextSeason: async (source, target) => {
      calls.push(`prepare-S${source}-to-S${target}`);
      return { success: false, action: 'WAITING_FOR_SEASON_RESULTS' };
    },
    readRollover: async () => { calls.push('read-plan'); return { ready: true }; },
  });

  assert.equal(result.success, false);
  assert.equal(result.action, 'WAITING_FOR_SEASON_RESULTS');
  assert.deepEqual(calls, ['prepare-S1-to-S2']);
});

test('a successful preparation is still rejected unless config confirms S2 is fully ready', async () => {
  const result = await runSeasonActivationFlow({
    readConfig: async () => ({ activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false }),
    prepareNextSeason: async () => ({ success: true }),
    readRollover: async () => ({ ready: true, targetSeason: 2 }),
  });

  assert.equal(result.success, false);
  assert.equal(result.action, 'WORLD_NOT_READY');
  assert.equal(result.reason, 'TARGET_SEASON_NOT_FULLY_PROVISIONED');
});

test('S2 remains unavailable to clients while worldReady is false', async () => {
  const result = await runSeasonActivationFlow({
    readConfig: async () => ({ activeSeasonNumber: 2, nextSeasonNumber: 2, worldReady: false, phase: 'GENERATING_NEXT' }),
    prepareNextSeason: async () => { throw new Error('must not prepare an already selected S2'); },
    readRollover: async () => { throw new Error('must not read a plan before readiness'); },
  });

  assert.equal(result.success, false);
  assert.equal(result.action, 'WORLD_NOT_READY');
  assert.equal(result.worldReady, false);
});


test('regular season cannot trigger next-season build or publication', async () => {
  const calls = [];
  const result = await runSeasonActivationFlow({
    readConfig: async () => ({ activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'REGULAR_SEASON', worldReady: true }),
    prepareNextSeason: async () => { calls.push('prepare'); return { success: true }; },
    readRollover: async () => { calls.push('read-plan'); return { ready: true, targetSeason: 2 }; },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'TRANSITION_PHASE_NOT_READY');
  assert.equal(result.phase, 'REGULAR_SEASON');
  assert.equal(result.writesStarted, false);
  assert.deepEqual(calls, []);
});

test('finalizing phase cannot publish before orchestrator advances to generating-next', async () => {
  const calls = [];
  const result = await runSeasonActivationFlow({
    readConfig: async () => ({ activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'FINALIZING', worldReady: false }),
    prepareNextSeason: async () => { calls.push('prepare'); return { success: true }; },
    readRollover: async () => { calls.push('read-plan'); return { ready: true, targetSeason: 2 }; },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'TRANSITION_PHASE_NOT_READY');
  assert.deepEqual(calls, []);
});

test('next-season preparation prefers a future preparation target over a stale active target', async () => {
  let config = { activeSeasonNumber: 2, nextSeasonNumber: 2, preparationTargetSeason: 3, phase: 'GENERATING_NEXT', worldReady: false };
  const calls = [];
  const result = await runSeasonActivationFlow({
    readConfig: async () => config,
    prepareNextSeason: async (source, target) => {
      calls.push(`prepare-S${source}-to-S${target}`);
      config = { activeSeasonNumber: 3, nextSeasonNumber: 3, preparationTargetSeason: 3, phase: 'REGULAR_SEASON', worldReady: true };
      return { success: true, action: 'SEASON_PUBLISHED', sourceSeason: source, targetSeason: target, worldReady: true };
    },
    readRollover: async target => {
      calls.push(`read-plan-S${target}`);
      return { sourceSeason: target - 1, targetSeason: target, ready: true };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.targetSeason, 3);
  assert.deepEqual(calls, ['prepare-S2-to-S3', 'read-plan-S3']);
});
