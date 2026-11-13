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


test('partial archive chunks resume only from a validated parent manifest', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const readStateStart = source.indexOf('readState: async () => {');
  const readStateEnd = source.indexOf('    preflight: state =>', readStateStart);
  assert.ok(readStateStart >= 0 && readStateEnd > readStateStart);
  const readState = source.slice(readStateStart, readStateEnd);
  assert.ok(readState.includes('Array.isArray(archiveData.matchManifest)'));
  assert.ok(readState.includes('validateSeasonArchiveSnapshot(archiveData, archiveData.matchManifest)'));
  assert.ok(readState.includes('archiveRecoveryPending: true'));
  assert.ok(readState.indexOf('archiveRecoveryPending: true') < readState.indexOf('readRolloverGroupPreflight'));

  const recoveryStart = source.indexOf("if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && !planSnap.exists)");
  const recoveryEnd = source.indexOf('  // A Firestore subcollection can outlive a missing parent document.', recoveryStart);
  const recovery = source.slice(recoveryStart, recoveryEnd);
  assert.ok(recovery.includes('const manifest = Array.isArray(archiveData.matchManifest)'));
  assert.ok(recovery.includes('SEASON_ARCHIVE_RECOVERY_CHILD_CONFLICT'));
  assert.ok(recovery.includes('const missingMatches = manifest.filter'));
  assert.ok(recovery.includes('SEASON_ARCHIVE_RECOVERY_SNAPSHOT_INVALID'));
  assert.ok(recovery.indexOf('manifestValidation') < recovery.indexOf('missingMatches'));
  assert.ok(recovery.indexOf('missingMatches') < recovery.indexOf('validateSeasonArchiveSnapshot(archiveData, savedMatches)'));

  const parentWrite = source.indexOf("status: 'preparing', matchManifest: matchArchive");
  const childWrite = source.indexOf('archiveRef.collection(\'matches\').doc(match.matchId)', parentWrite);
  assert.ok(parentWrite >= 0, 'parent must contain a complete immutable manifest');
  assert.ok(childWrite > parentWrite, 'parent manifest must be committed before match chunks');
  assert.ok(source.includes('SEASON_ARCHIVE_MANIFEST_TOO_LARGE'));
});


test('crash after plan publication resumes from the saved plan without recalculating placements', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const readStateStart = source.indexOf('readState: async () => {');
  const readStateEnd = source.indexOf('    preflight: state =>', readStateStart);
  const readState = source.slice(readStateStart, readStateEnd);
  assert.ok(readState.includes("archiveData.status === 'preparing' && Array.isArray(archiveData.matchManifest)"));
  assert.ok(readState.includes('planSnap.exists && !validateRolloverPlan'));
  assert.ok(readState.includes('archivePlanAlreadyPublished: planSnap.exists'));
  assert.ok(readState.indexOf('archivePlanAlreadyPublished') < readState.indexOf('readRolloverGroupPreflight'));

  const recoveryStart = source.indexOf("if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && planSnap.exists)");
  const recoveryEnd = source.indexOf("if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && !planSnap.exists)", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'published-plan recovery must run before no-plan recovery');
  const recovery = source.slice(recoveryStart, recoveryEnd);

  assert.ok(recovery.includes('validateSeasonArchiveSnapshot(archiveData, savedMatches)'));
  assert.ok(recovery.includes('validateRolloverPlan(savedPlan, sourceSeason, targetSeason)'));
  assert.ok(recovery.includes('applySeasonAwards(db, sourceSeason, archiveData.standings || {}, lock)'));
  assert.ok(recovery.includes('data: { awards }'));
  assert.ok(recovery.includes('resumedAfterPlanPublication: true'));
  assert.ok(!recovery.includes('buildPromotionRelegationGroups('), 'saved placements must not be recalculated');
  assert.ok(!recovery.includes('data: { groups:'), 'saved plan groups must never be overwritten');
  assert.ok(recovery.indexOf('validateRolloverPlan') < recovery.indexOf('applySeasonAwards'));
  assert.ok(recovery.indexOf('applySeasonAwards') < recovery.indexOf('data: { awards }'));
  assert.ok(recovery.indexOf('isSeasonArchiveReadyToComplete') < recovery.indexOf("data: { status: 'completed'"));
});

test('a published rollover plan is preserved while only award reconciliation metadata is refreshed', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const start = source.indexOf("if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && planSnap.exists)");
  const end = source.indexOf("if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && !planSnap.exists)", start);
  const branch = source.slice(start, end);
  const planWrite = branch.slice(branch.indexOf('ref: planRef'), branch.indexOf('const refreshedPlanSnap'));
  assert.match(planWrite, /data:\s*\{\s*awards\s*\}/);
  assert.doesNotMatch(planWrite, /groups\s*:/);
  assert.match(branch, /const savedPlan = planSnap\.data\(\) \|\| \{\}/);
  assert.match(branch, /validateRolloverPlan\(savedPlan, sourceSeason, targetSeason\)/);
});
