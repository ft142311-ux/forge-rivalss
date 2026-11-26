import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const preflight = readFileSync(new URL('../src/app/api/admin/staging-season-one-preflight/route.ts', import.meta.url), 'utf8');
const reset = readFileSync(new URL('../src/app/api/admin/staging-season-one-reset/route.ts', import.meta.url), 'utf8');

test('Season 1 preflight is pinned to the current Beta Firebase project and branch', () => {
  assert.match(preflight, /const EXPECTED_PROJECT = 'forge-rivals-beta'/);
  assert.match(preflight, /const EXPECTED_BRANCH = 'feature\/beta-fresh-season-one'/);
  assert.match(preflight, /process\.env\.VERCEL_ENV === 'preview'/);
  assert.match(preflight, /process\.env\.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH/);
});

test('Season 1 reset executor independently enforces the same Preview, branch, and project fence', () => {
  assert.match(reset, /const EXPECTED_PROJECT = 'forge-rivals-beta'/);
  assert.match(reset, /const EXPECTED_BRANCH = 'feature\/beta-fresh-season-one'/);
  assert.match(reset, /process\.env\.VERCEL_ENV === 'preview'/);
  assert.match(reset, /process\.env\.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH/);
  assert.match(reset, /configuredProject === EXPECTED_PROJECT/);
  assert.match(reset, /initializedProject === EXPECTED_PROJECT/);
});

test('Reset executor still requires the server-only cron secret and explicit confirmation', () => {
  assert.match(reset, /if \(!isCronAuthorized\(request\)\)/);
  assert.match(reset, /body\?\.confirmation !== 'RESET_BETA_SEASON_ONE'/);
});
