import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('legacy season recovery endpoints outside the canonical orchestrator are disabled fail-closed', () => {
  const routes = [
    'src/app/api/cron/recover-season-gap/route.ts',
    'src/app/api/cron/reconstruct-sequential-seasons/route.ts',
    'src/app/api/cron/complete-recovered-season-two/route.ts',
    'src/app/api/cron/finish-test-season/route.ts',
  ];
  for (const path of routes) {
    const source = read(path);
    assert.match(source, /LEGACY_SEASON_RECOVERY_DISABLED/);
    assert.match(source, /(SEASON_1_TO_2_ONLY_RECOVERY_SCOPE|CANONICAL_ORCHESTRATOR_ONLY)/);
    assert.match(source, /writesStarted:\s*false/);
    assert.doesNotMatch(source, /recoverIncompleteSeasonTwo|reconstructMissingSeasonTwoAndPrepareSeasonThree|completeRecoveredSeasonTwo|ensureSeasonCalendar|publishPreparedSeason/);
  }
});

test('manual Season 1 rollover recovery is restricted to the disposable local emulator', () => {
  const source = read('src/app/api/cron/recover-season-rollover/route.ts');
  const guard = source.indexOf("action: 'LOCAL_EMULATOR_ONLY'");
  const database = source.indexOf('const db = getAdminDb()');
  assert.ok(guard >= 0 && database > guard, 'non-emulator requests must be rejected before Firestore is accessed');
  assert.match(source, /FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /projectId !== 'demo-forge-rivals'/);
  assert.match(source, /writesStarted: false/);
  assert.match(source, /sourceSeason !== 1/);
});

test('public staging health endpoint is uncached and does not expose backend exception details', () => {
  const source = read('src/app/api/health/route.ts');
  assert.match(source, /export const dynamic = 'force-dynamic'/);
  assert.match(source, /Cache-Control': 'no-store'/);
  assert.match(source, /error: 'FIRESTORE_UNAVAILABLE'/);
  assert.match(source, /console\.error\('\[HEALTH CHECK FAILED\]:', error\)/);
  assert.doesNotMatch(source, /error:\s*error\.message/);
});

test('disposable Season 1 preparation action is locally fenced before Firestore access', () => {
  const source = read('src/app/actions/season-cycle.ts');
  const start = source.indexOf('export async function finishTestSeason1AndPrepareSeason2()');
  assert.ok(start >= 0, 'disposable recovery action must remain explicit');
  const body = source.slice(start);
  const guard = body.indexOf("action: 'LOCAL_EMULATOR_ONLY'");
  const database = body.indexOf('const db = getAdminDb()');
  assert.ok(guard >= 0 && database > guard, 'non-emulator calls must be rejected before Firestore is accessed');
  assert.match(body, /FIRESTORE_EMULATOR_HOST/);
  assert.match(body, /projectId !== 'demo-forge-rivals'/);
  assert.match(body, /writesStarted: false/);
});
