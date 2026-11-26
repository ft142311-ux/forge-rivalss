import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/app/api/admin/staging-cup-diagnostics/route.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/beta-season-one-preflight.yml', import.meta.url), 'utf8');

test('Beta read-only preflight runs automatically after pushes to the isolated Beta branch', () => {
  assert.doesNotMatch(workflow, /\bon:\s*\n\s+push:/);
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /npx --yes vercel@latest curl[\s\S]*--request GET/);
  assert.doesNotMatch(workflow, /--request POST|RESET_BETA_SEASON_ONE/);
});

test('Beta diagnostics explicitly identify the Firebase project and remain read-only', () => {
  assert.match(route, /EXPECTED_PROJECT = 'forge-rivals-beta'/);
  assert.match(route, /projectId: EXPECTED_PROJECT/);
  assert.match(route, /export async function GET/);
  assert.match(route, /isCronAuthorized\(request\)/);
  assert.match(route, /readOnly: true/);
  assert.doesNotMatch(route, /\b(?:db|tx)\.(?:set|create|update|delete)\s*\(|\.runTransaction\s*\(/);
});

test('Beta Cup preflight exposes full sequential round and fixture integrity', () => {
  assert.match(route, /expectedPairings = \[56, 32, 16, 8, 4, 2, 1\]/);
  assert.match(route, /fixtureIntegrity/);
  assert.match(route, /bestOf/);
  assert.match(route, /roundSummary\.every/);
  assert.match(route, /cupMustBeCompleted = activeSeason > 1/);
  assert.match(workflow, /SEASON_ONE_CUP_INTEGRITY_FAILED/);
  assert.match(workflow, /SEASON_ONE_CUP_PARTICIPANT_COUNT_INVALID/);
  assert.match(workflow, /SEASON_ONE_CUP_OPENING_ROUND_INVALID/);
});

test('Beta preflight diagnoses current league, rollover, archive retention and prepared successor', () => {
  assert.match(route, /diagnoseSeasonRolloverPreflight\(db, activeSeason\)/);
  assert.match(route, /validateRolloverPlan\(plan, activeSeason, activeSeason \+ 1\)/);
  assert.match(route, /validateSeasonArchiveRolloverPlan/);
  assert.match(route, /retainedArchiveMatchesPolicy/);
  assert.match(route, /preparedSeason:/);
  assert.match(route, /transitionPrerequisitesReady/);
  assert.match(route, /mode !== 'recovery_carry_forward'/);
  assert.match(workflow, /ACTIVE_SEASON_LEAGUE_COUNTS_INVALID/);
  assert.match(workflow, /SEASON_HISTORY_CLEANUP_PENDING/);
});
