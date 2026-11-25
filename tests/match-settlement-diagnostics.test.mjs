import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/api/admin/match-settlement-diagnostics/route.ts', import.meta.url), 'utf8');

test('match settlement diagnostics are read-only and require a verified admin token', () => {
  assert.match(source, /requireAdminActor\(match\[1\]\)/);
  assert.match(source, /ADMIN_REQUIRED/);
  assert.match(source, /writesStarted: false/);
  assert.doesNotMatch(source, /\.set\(|\.update\(|\.delete\(|runTransaction\(/);
});

test('match settlement diagnostics are pinned to the Beta preview project and branch', () => {
  assert.match(source, /EXPECTED_PROJECT = 'forge-rivals-beta'/);
  assert.match(source, /VERCEL_ENV !== 'preview'/);
  assert.match(source, /VERCEL_GIT_COMMIT_REF !== 'feature\/beta-fresh-season-one'/);
});

test('diagnostics inspect both canonical league fixtures and the active Pyramid Cup round', () => {
  assert.match(source, /collection\('matches_v2'\)\.where\('season', ==, season\)/);
  assert.match(source, /collection\('cup_pyramid_v1'\)/);
  assert.match(source, /collection\('cup_matches'\)/);
  assert.match(source, /collection\('matches_v2'\)\.where\('cupId'/);
  assert.match(source, /roundFixturesWithMatchDocuments/);
});

test('diagnostics expose overdue, unfinished, processing-lock and settlement-error aggregates only', () => {
  for (const field of ['overdue', 'unfinished', 'processing', 'staleProcessing', 'recentErrorCodes', 'leagueMatchesPaused']) {
    assert.ok(source.includes(field), `missing diagnostic field: ${field}`);
  }
  assert.doesNotMatch(source, /homeName|awayName|homeId|awayId|email|ownedPlayers/);
});
