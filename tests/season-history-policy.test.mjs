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
