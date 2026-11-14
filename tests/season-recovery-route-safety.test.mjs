import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('legacy recovery endpoints that advance to S3 are disabled fail-closed', () => {
  const routes = [
    'src/app/api/cron/recover-season-gap/route.ts',
    'src/app/api/cron/reconstruct-sequential-seasons/route.ts',
    'src/app/api/cron/complete-recovered-season-two/route.ts',
  ];
  for (const path of routes) {
    const source = read(path);
    assert.match(source, /LEGACY_SEASON_RECOVERY_DISABLED/);
    assert.match(source, /SEASON_1_TO_2_ONLY_RECOVERY_SCOPE/);
    assert.match(source, /writesStarted:\s*false/);
    assert.doesNotMatch(source, /recoverIncompleteSeasonTwo|reconstructMissingSeasonTwoAndPrepareSeasonThree|completeRecoveredSeasonTwo|ensureSeasonCalendar|publishPreparedSeason/);
  }
});
