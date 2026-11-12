import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostActivationRetry } from '../src/app/actions/season-history-policy.ts';

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
