import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSeasonCatchUpPolicy } from '../src/app/actions/season-history-policy.ts';

test('incomplete elapsed seasons can be skipped without fabricating results', () => {
  const result = resolveSeasonCatchUpPolicy([1, 2, 3], {
    1: { status: 'completed', archiveValid: true },
    2: { status: 'incomplete', reason: 'UNFINISHED_MATCHES' },
    3: { status: 'no_canonical_results' },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.skippedSeasons.map(item => item.seasonNumber), [2, 3]);
  assert.equal(result.retainedArchiveSeason, 1);
  assert.deepEqual(result.archivesToPruneAfterActivation, []);
});

test('only the latest completed season is retained when later seasons are skipped', () => {
  const result = resolveSeasonCatchUpPolicy([1, 2, 3, 4], {
    1: { status: 'completed', archiveValid: true },
    2: { status: 'completed', archiveValid: true },
    3: { status: 'incomplete' },
    4: { status: 'completed', archiveValid: true },
  });
  assert.equal(result.ready, true);
  assert.equal(result.retainedArchiveSeason, 4);
  assert.deepEqual(result.archivesToPruneAfterActivation, [1, 2]);
  assert.deepEqual(result.skippedSeasons.map(item => item.seasonNumber), [3]);
});

test('a completed season with a missing or invalid archive cannot be silently skipped', () => {
  const result = resolveSeasonCatchUpPolicy([2], {
    2: { status: 'completed', archiveValid: false, archiveReason: 'ARCHIVE_MISSING' },
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SEASON_HISTORY_REQUIRES_RECONCILIATION');
  assert.equal(result.skippedSeasons.length, 0);
});

test('unknown history and integrity conflicts fail closed', () => {
  for (const state of [
    undefined,
    { status: 'unknown' },
    { status: 'integrity_conflict', reason: 'DUPLICATE_FIXTURES' },
  ]) {
    const result = resolveSeasonCatchUpPolicy([3], state ? { 3: state } : {});
    assert.equal(result.ready, false);
    assert.equal(result.retainedArchiveSeason, null);
  }
});

test('a skipped season never becomes an archive or rollover source', () => {
  const result = resolveSeasonCatchUpPolicy([1, 2], {
    1: { status: 'completed', archiveValid: true },
    2: { status: 'incomplete' },
  });
  assert.deepEqual(result.completedSeasons, [1]);
  assert.equal(result.retainedArchiveSeason, 1);
  assert.deepEqual(result.archivesToPruneAfterActivation, []);
});


test('season award retries are blocked by either the player marker or the economy ledger', async () => {
  const { isSeasonAwardAlreadyApplied } = await import('../src/app/actions/season-awards-policy.ts');
  assert.equal(isSeasonAwardAlreadyApplied({ seasonAwards: { S4: { prize: 100 } } }, false, 4), true);
  assert.equal(isSeasonAwardAlreadyApplied({}, true, 4), true);
  assert.equal(isSeasonAwardAlreadyApplied({ seasonAwards: { S3: { prize: 100 } } }, false, 4), false);
  assert.equal(isSeasonAwardAlreadyApplied({}, false, 4), false);
  assert.equal(isSeasonAwardAlreadyApplied({}, false, 0), true);
});

test('pending skipped history marker is created only when absent and reused unchanged on retry', async () => {
  const { resolvePendingSkippedHistoryMarker } = await import('../src/app/actions/season-history-policy.ts');
  const expected = { seasonNumber: 3, reason: 'SEASON_INCOMPLETE', targetSeason: 4 };
  assert.deepEqual(resolvePendingSkippedHistoryMarker(null, expected), {
    ready: true, shouldWrite: true, reason: null,
  });
  assert.deepEqual(resolvePendingSkippedHistoryMarker({
    seasonNumber: 3,
    status: 'SKIPPED_PENDING_ACTIVATION',
    reason: 'SEASON_INCOMPLETE',
    targetSeason: 4,
    noResultsFabricated: true,
    awardsApplied: false,
    promotionRelegationApplied: false,
    createdAt: 'first-write',
  }, expected), {
    ready: true, shouldWrite: false, reason: null,
  });
});

test('pending skipped history marker rejects conflicting or already-finalized records', async () => {
  const { resolvePendingSkippedHistoryMarker } = await import('../src/app/actions/season-history-policy.ts');
  const expected = { seasonNumber: 3, reason: 'SEASON_INCOMPLETE', targetSeason: 4 };
  const valid = {
    seasonNumber: 3,
    status: 'SKIPPED_PENDING_ACTIVATION',
    reason: 'SEASON_INCOMPLETE',
    targetSeason: 4,
    noResultsFabricated: true,
    awardsApplied: false,
    promotionRelegationApplied: false,
  };
  for (const conflicting of [
    { ...valid, targetSeason: 5 },
    { ...valid, reason: 'NO_CANONICAL_RESULTS' },
    { ...valid, status: 'SKIPPED', activatedTargetSeason: 4 },
    { ...valid, awardsApplied: true },
    { ...valid, noResultsFabricated: false },
  ]) {
    assert.deepEqual(resolvePendingSkippedHistoryMarker(conflicting, expected), {
      ready: false, shouldWrite: false, reason: 'SKIPPED_SEASON_HISTORY_CONFLICT',
    });
  }
});

test('activated skipped history marker finalizes a matching pending marker exactly once', async () => {
  const { resolveActivatedSkippedHistoryMarker } = await import('../src/app/actions/season-history-policy.ts');
  const expected = { seasonNumber: 3, reason: 'SEASON_INCOMPLETE', targetSeason: 4 };
  assert.deepEqual(resolveActivatedSkippedHistoryMarker(null, expected), {
    ready: true, shouldWrite: true, reason: null,
  });
  const pending = {
    seasonNumber: 3,
    status: 'SKIPPED_PENDING_ACTIVATION',
    reason: 'SEASON_INCOMPLETE',
    targetSeason: 4,
    noResultsFabricated: true,
    awardsApplied: false,
    promotionRelegationApplied: false,
  };
  assert.deepEqual(resolveActivatedSkippedHistoryMarker(pending, expected), {
    ready: true, shouldWrite: true, reason: null,
  });
  assert.deepEqual(resolveActivatedSkippedHistoryMarker({
    ...pending,
    status: 'SKIPPED',
    activatedTargetSeason: 4,
  }, expected), {
    ready: true, shouldWrite: false, reason: null,
  });
});

test('activated skipped history marker refuses to overwrite a conflicting lifecycle record', async () => {
  const { resolveActivatedSkippedHistoryMarker } = await import('../src/app/actions/season-history-policy.ts');
  const expected = { seasonNumber: 3, reason: 'SEASON_INCOMPLETE', targetSeason: 4 };
  const pending = {
    seasonNumber: 3,
    status: 'SKIPPED_PENDING_ACTIVATION',
    reason: 'SEASON_INCOMPLETE',
    targetSeason: 4,
    noResultsFabricated: true,
    awardsApplied: false,
    promotionRelegationApplied: false,
  };
  for (const conflicting of [
    { ...pending, targetSeason: 5 },
    { ...pending, reason: 'OTHER_REASON' },
    { ...pending, status: 'COMPLETED' },
    { ...pending, status: 'SKIPPED', activatedTargetSeason: 5 },
    { ...pending, promotionRelegationApplied: true },
  ]) {
    assert.deepEqual(resolveActivatedSkippedHistoryMarker(conflicting, expected), {
      ready: false, shouldWrite: false, reason: 'SKIPPED_SEASON_HISTORY_CONFLICT',
    });
  }
});

