import test from 'node:test';
import assert from 'node:assert/strict';
import { runSeasonActivationFlow } from '../src/app/actions/season-transition-flow.ts';

test('a repeated activation is read-only after S2 is already published', async () => {
  const calls = [];
  const config = { activeSeasonNumber: 2, nextSeasonNumber: 2, worldReady: true };

  const result = await runSeasonActivationFlow({
    readConfig: async () => config,
    prepareNextSeason: async () => { throw new Error('repeat must not rebuild S2'); },
    readRollover: async season => { calls.push(`read-plan-S${season}`); return { ready: true, targetSeason: 2 }; },
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, ['read-plan-S2']);
  assert.equal(config.activeSeasonNumber, 2);
});

test('an incomplete calendar cannot publish S2 and preserves the S1 active marker', async () => {
  const config = { activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false };
  const result = await runSeasonActivationFlow({
    readConfig: async () => config,
    prepareNextSeason: async () => ({ success: true, action: 'WORLD_BUILDING' }),
    readRollover: async () => { throw new Error('incomplete calendar must not read the activation plan'); },
  });

  assert.equal(result.success, false);
  assert.equal(result.action, 'WORLD_NOT_READY');
  assert.equal(result.reason, 'TARGET_SEASON_NOT_FULLY_PROVISIONED');
  assert.equal(config.activeSeasonNumber, 1);
  assert.equal(config.worldReady, false);
});

test('a build error stops before publication and leaves S1 active', async () => {
  const config = { activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'WORLD_BUILDING', worldReady: false };
  const result = await runSeasonActivationFlow({
    readConfig: async () => config,
    prepareNextSeason: async () => ({ success: false, action: 'WORLD_BUILDING', reason: 'BUILD_FAILED' }),
    readRollover: async () => { throw new Error('build failure must not read the activation plan'); },
  });

  assert.equal(result.success, false);
  assert.equal(result.action, 'WORLD_BUILDING');
  assert.equal(result.preparation.reason, 'BUILD_FAILED');
  assert.equal(config.activeSeasonNumber, 1);
  assert.equal(config.worldReady, false);
});

test('a successful preparation followed by a stale S1 config is not treated as activation', async () => {
  const reads = [];
  const configs = [
    { activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false },
    { activeSeasonNumber: 1, nextSeasonNumber: 2, phase: 'GENERATING_NEXT', worldReady: false },
  ];

  const result = await runSeasonActivationFlow({
    readConfig: async () => configs[reads.push('config') - 1],
    prepareNextSeason: async () => ({ success: true, action: 'WORLD_BUILDING' }),
    readRollover: async () => { throw new Error('stale S1 config must not read the activation plan'); },
  });

  assert.equal(result.success, false);
  assert.equal(result.action, 'WORLD_NOT_READY');
  assert.equal(result.activeSeason, 1);
  assert.equal(result.worldReady, false);
  assert.deepEqual(reads, ['config', 'config']);
});
