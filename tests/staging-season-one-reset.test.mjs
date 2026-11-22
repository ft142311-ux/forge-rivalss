import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('fresh Beta Season 1 preflight is authenticated, project-fenced and read-only', () => {
  const source = read('src/app/api/admin/staging-season-one-reset/route.ts');
  assert.match(source, /isCronAuthorized\(request\)/);
  assert.match(source, /EXPECTED_PROJECT = 'forge-rivalstest'/);
  assert.match(source, /export async function GET/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /league_tables_v2/);
  assert.match(source, /league_slots_v1/);
  assert.match(source, /matches_v2/);
  assert.match(source, /players_v14/);
  assert.doesNotMatch(source, /\.set\(|\.create\(|\.update\(|\.delete\(|runTransaction\(/);
  assert.doesNotMatch(source, /participantIds|profileIds/);
});

test('fresh Season 1 reset plan preserves every profile and rejects unsafe source worlds', () => {
  const source = read('src/app/actions/staging-season-one-reset-plan.ts');
  assert.match(source, /ACTIVE_SEASON_MUST_BE_1/);
  assert.match(source, /PREPARED_NEXT_SEASON_EXISTS/);
  assert.match(source, /PARTICIPANT_PROFILE_MISSING/);
  assert.match(source, /OCCUPIED_SLOT_STANDINGS_MISMATCH/);
  assert.match(source, /worldGeneration: 'CLEAN_S1_V1'/);
  assert.match(source, /participantProfiles: validProfiles/);
  assert.match(source, /allPlayerProfiles: true/);
  assert.match(source, /accountCredentials: true/);
  assert.match(source, /nextMoscowSeasonBoundary/);
  assert.match(source, /17 \* 86400000/);
});
