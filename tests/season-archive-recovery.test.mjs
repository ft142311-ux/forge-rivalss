import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../src/app/actions/season-rollover.ts', import.meta.url);

test('preparing archive recovery uses the persisted snapshot instead of rebuilding standings', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const start = source.indexOf("if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && !planSnap.exists)");
  assert.ok(start >= 0, 'recovery path for a preparing archive without a plan must exist');

  const end = source.indexOf('  // Mutable snapshots are refreshed after any explicit Season 1 repair writes.', start);
  assert.ok(end > start, 'recovery branch must be bounded before normal live-state processing');
  const branch = source.slice(start, end);

  assert.ok(branch.includes('validateSeasonArchiveSnapshot(archiveData, savedMatches)'));
  assert.ok(branch.includes('buildPromotionRelegationGroups(archiveData.standings || {})'));
  assert.ok(branch.includes('applySeasonAwards(db, sourceSeason, archiveData.standings || {}, lock)'));
  assert.ok(branch.includes('recoveredFromArchiveSnapshot: true'));
  assert.ok(!branch.includes('calculateGroupStandings('), 'recovery must not recalculate standings from mutable live fixtures');
  assert.ok(!branch.includes('freshTablesSnap'), 'recovery must not read live standings projections');
  assert.ok(branch.indexOf('validateSeasonArchiveSnapshot') < branch.indexOf('applySeasonAwards'));
  assert.ok(branch.indexOf('applySeasonAwards') < branch.indexOf('ref: planRef'));
  assert.ok(branch.indexOf('isSeasonArchiveReadyToComplete') < branch.indexOf("data: { status: 'completed'"));
});

test('orphaned archive match chunks and unknown archive states fail closed before normal writes', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const orphanGuard = source.indexOf('ORPHANED_PARTIAL_SEASON_ARCHIVE_REQUIRES_RECONCILIATION');
  const statusGuard = source.indexOf('SEASON_ARCHIVE_STATUS_REQUIRES_RECONCILIATION');
  const normalLiveProcessing = source.indexOf('const needsSettlement =');

  assert.ok(orphanGuard >= 0, 'orphaned subcollection records must not be overwritten');
  assert.ok(statusGuard > orphanGuard, 'unknown archive states must be rejected');
  assert.ok(normalLiveProcessing > statusGuard, 'archive-state guards must run before live-state processing');
});
