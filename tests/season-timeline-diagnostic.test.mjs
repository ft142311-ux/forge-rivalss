import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveSeasonDatePlan } from '../src/app/actions/season-boundary.ts';

const root = resolve(import.meta.dirname, '..');
const routePath = resolve(root, 'src/app/api/cron/diagnose-season-timeline/route.ts');

test('calendar dates identify S4 as active on November 12 after S1-S3 elapsed', () => {
  const plan = deriveSeasonDatePlan(
    1,
    new Date('2026-09-21T15:00:00.000Z'),
    new Date('2026-10-08T15:00:00.000Z'),
    new Date('2026-11-12T12:00:00.000Z'),
    15,
  );
  assert.deepEqual(plan.completedSeasons, [1, 2, 3]);
  assert.equal(plan.expectedSeasonNumber, 4);
  assert.equal(plan.expectedSeasonStart.toISOString(), '2026-11-07T15:00:00.000Z');
  assert.equal(plan.expectedNextSeasonStart.toISOString(), '2026-11-22T15:00:00.000Z');
});

test('season timeline endpoint is authenticated and strictly read-only', () => {
  const source = readFileSync(routePath, 'utf8');
  assert.match(source, /isCronAuthorized/);
  assert.match(source, /readOnly:\s*true/);
  assert.match(source, /writesStarted:\s*false/);
  assert.match(source, /diagnoseSeasonRolloverPreflight/);
  assert.match(source, /validateSeasonArchiveSnapshot/);
  assert.match(source, /validateRolloverPlan/);
  assert.doesNotMatch(source, /\.set\(|\.update\(|\.delete\(|runTransaction\(|batch\(/);
  assert.doesNotMatch(source, /runMatchEngine|resolveUniversalMatchDocument|ensureSeasonCalendar|publishPreparedSeason|activatePublishedSeason/);
});

test('timeline diagnostic follows one-archive retention and recognizes incomplete latest history', () => {
  const source = readFileSync(routePath, 'utf8');
  assert.match(source, /maxCompletedArchives:\s*1/);
  assert.match(source, /retainedArchiveSeason/);
  assert.match(source, /skipped_incomplete/);
  assert.match(source, /blocked_completed_archive_required/);
  assert.doesNotMatch(source, /for\s*\(const seasonNumber of elapsedSeasons\)/);
});

test('diagnostic validates the target rollover plan even when the prior season is skipped', () => {
  const source = readFileSync(routePath, 'utf8');
  assert.match(source, /rolloverValidation = validateRolloverPlan/);
  assert.match(source, /recoveredIncompleteArchive/);
  assert.match(source, /NO_CANONICAL_RESULTS/);
  assert.match(source, /olderValidArchiveSeasons/);
});

test('calendar recovery archives completed seasons, skips incomplete seasons and prunes only after activation', () => {
  const source = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  assert.match(source, /prepareRecoveryCarryForwardPlan/);
  assert.match(source, /prepareSeasonRollover\(db, season, season \+ 1\)/);
  assert.match(source, /SKIPPED_PENDING_ACTIVATION/);
  assert.match(source, /pruneSeasonHistoryAfterActivation/);
  assert.match(source, /ARCHIVE_PRUNE_PREFLIGHT_FAILED/);
  assert.match(source, /SEASON_HISTORY_CLEANUP_TARGET_NOT_ACTIVE/);
  assert.doesNotMatch(source, /runMatchEngine|resolveUniversalMatchDocument/);
});

test('adjacent incomplete seasons can use the same carry-forward recovery path', () => {
  const source = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  assert.match(source, /SEASON_RESULTS_INCOMPLETE/);
  assert.match(source, /SEASON_STANDINGS_PREFLIGHT_FAILED/);
  assert.match(source, /canClassifyIncompleteSource/);
  assert.match(source, /preparedRecoveryMode: directRecovery \|\| rolloverPlan\?\.mode === 'recovery_carry_forward'/);
  assert.match(source, /overdueRecoveryMode = recoveryMode/);
});

test('explicit league matches without canonical coordinates are integrity conflicts, not skippable emptiness', () => {
  const calendar = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  const diagnostic = readFileSync(routePath, 'utf8');
  assert.match(calendar, /explicitlyLeague = matchType === 'league'/);
  assert.match(calendar, /INVALID_CANONICAL_FIXTURE_COORDINATE/);
  assert.match(diagnostic, /invalidExplicitLeagueMatch/);
});


test('recovery builder uses the canonical source date window before deriving a multi-season target', () => {
  const source = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  assert.match(source, /resolvedSourceWindow = resolveCanonicalSeasonDateWindow/);
  assert.match(source, /sourceNextBoundary = new Date\(nextBoundary\.getTime\(\)\)/);
  assert.match(source, /deriveRecoverySeasonWindow\(/);
});


test('invalid older archives block recovery and are never treated as harmless cleanup candidates', () => {
  const calendar = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  const diagnostic = readFileSync(routePath, 'utf8');
  assert.match(calendar, /if \(invalidPreviousArchiveSeasons\.length > 0\)/);
  assert.match(diagnostic, /if \(invalidOlderArchives\.length > 0\)/);
});


test('history cleanup requires the target season to be the active ready world', () => {
  const source = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  assert.match(source, /Number\(activeConfig\.activeSeasonNumber\) !== targetSeason/);
  assert.match(source, /activeConfig\.worldReady !== true/);
});


test('incomplete and preparing seasons persist truthful participant snapshots instead of fabricating final standings', () => {
  const source = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  const archive = readFileSync(resolve(root, 'src/app/actions/season-archive.ts'), 'utf8');
  assert.match(source, /persistRecoveredArchive/);
  assert.match(source, /PREPARING_SEASON_ARCHIVE_RECOVERY_FAILED/);
  assert.match(source, /liveState\.status === 'incomplete' \|\| liveState\.status === 'no_canonical_results'/);
  assert.match(source, /buildRecoveredSeasonArchiveSnapshot/);
  assert.match(archive, /finalStandingsAvailable: false/);
  assert.match(archive, /unresolvedMatches: MATCHES_PER_SEASON - finishedMatches/);
});


test('recovery plan promotion metadata follows the actual selected placement baseline', () => {
  const source = readFileSync(resolve(root, 'src/app/actions/season-calendar.ts'), 'utf8');
  assert.match(source, /promotionRule: placementBaseline === 'completed_archive'/);
});
