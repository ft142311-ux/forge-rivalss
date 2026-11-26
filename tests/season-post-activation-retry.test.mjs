import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActivatedSkippedSeasons, resolveHistoryCleanupCompletion, resolvePostActivationRetry } from '../src/app/actions/season-history-policy.ts';

test('committed activation with pending cleanup resumes against the active season', () => {
  assert.deepEqual(
    resolvePostActivationRetry({
      activeSeasonNumber: 2,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 2,
      worldReady: true,
      preparedSeasonNumber: undefined,
    }),
    { ready: true, sourceSeason: 1, targetSeason: 2 },
  );
});

test('activation cleanup retry rejects a target that is not the active season', () => {
  const result = resolvePostActivationRetry({
    activeSeasonNumber: 3,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 2,
    worldReady: true,
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'ACTIVATION_CLEANUP_STATE_INVALID');
});

test('activation cleanup retry does nothing when no cleanup is pending', () => {
  assert.deepEqual(
    resolvePostActivationRetry({
      activeSeasonNumber: 2,
      historyCleanupPending: false,
      historyCleanupTargetSeason: 2,
      worldReady: true,
    }),
    { ready: false, reason: 'NO_PENDING_ACTIVATION_CLEANUP' },
  );
});

test('activation cleanup retry rejects a world that is not ready', () => {
  const result = resolvePostActivationRetry({
    activeSeasonNumber: 2,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 2,
    worldReady: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'ACTIVATION_CLEANUP_STATE_INVALID');
});

import { expectedRolloverGroups, resolveRolloverPlanPruneIds } from '../src/app/actions/season-rollover-plan.ts';

function makePlan(season) {
  return {
    sourceSeason: season - 1,
    targetSeason: season,
    ready: true,
    groups: Object.fromEntries(expectedRolloverGroups().map(group => [
      group,
      Array.from({ length: 8 }, (_, index) => ({
        id: `S${season}-${group}-R${index + 1}`,
        rank: index + 1,
      })),
    ])),
  };
}

test('history cleanup keeps the currently activated rollover plan', () => {
  const result = resolveRolloverPlanPruneIds([
    { id: 'S1', plan: makePlan(1) },
    { id: 'S2', plan: makePlan(2) },
  ], 2);
  assert.equal(result.ready, true);
  assert.deepEqual(result.pruneIds, ['S1']);
});

test('history cleanup refuses to prune anything when the active plan is invalid', () => {
  const invalidActivePlan = makePlan(2);
  invalidActivePlan.groups['D1-G1'].pop();
  const result = resolveRolloverPlanPruneIds([
    { id: 'S1', plan: makePlan(1) },
    { id: 'S2', plan: invalidActivePlan },
  ], 2);
  assert.equal(result.ready, false);
  assert.deepEqual(result.pruneIds, []);
});


test('post-activation retry restores the final SKIPPED history markers from durable state', () => {
  const skipped = [
    { seasonNumber: 2, reason: 'UNFINISHED_MATCHES' },
    { seasonNumber: 3, reason: 'NO_CANONICAL_RESULTS' },
  ];
  const result = resolveActivatedSkippedSeasons(skipped, 4);
  assert.equal(result.ready, true);
  assert.deepEqual(result.seasons, skipped);
});

test('post-activation retry rejects duplicate, future, and malformed skipped-season markers', () => {
  for (const skipped of [
    [{ seasonNumber: 2 }, { seasonNumber: 2 }],
    [{ seasonNumber: 4 }],
    [{ seasonNumber: 0 }],
    'not-an-array',
  ]) {
    const result = resolveActivatedSkippedSeasons(skipped, 4);
    assert.equal(result.ready, false);
    assert.deepEqual(result.seasons, []);
  }
});

test('normal activation without skipped seasons produces an empty idempotent history update', () => {
  assert.deepEqual(resolveActivatedSkippedSeasons(undefined, 2), { ready: true, seasons: [] });
});


test('stale cleanup worker cannot clear a newer season cleanup marker', () => {
  const result = resolveHistoryCleanupCompletion({
    activeSeasonNumber: 3,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 3,
    worldReady: true,
  }, 2);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'HISTORY_CLEANUP_TARGET_CHANGED');
});

test('cleanup completion is idempotent for its own activated season', () => {
  assert.deepEqual(
    resolveHistoryCleanupCompletion({
      activeSeasonNumber: 2,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 2,
      worldReady: true,
    }, 2),
    { ready: true, reason: null, shouldMarkComplete: true },
  );
  assert.deepEqual(
    resolveHistoryCleanupCompletion({
      activeSeasonNumber: 2,
      historyCleanupPending: false,
      historyCleanupTargetSeason: 2,
      worldReady: true,
    }, 2),
    { ready: true, reason: null, shouldMarkComplete: false },
  );
});
