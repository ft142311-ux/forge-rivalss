import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/cup/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('Pyramid Cup control is read-only and requires a verified Control admin', () => {
  assert.match(route, /requireControlAdmin\(match\[1\]\)/);
  assert.match(route, /cup_pyramid_v1/);
  assert.match(route, /cup_matches/);
  assert.match(route, /matches_v2/);
  assert.doesNotMatch(route, /\.set\(|\.update\(|\.delete\(|\.create\(|\.add\(/);
});

test('Pyramid Cup diagnostics reconcile bracket rounds with canonical fixture results', () => {
  assert.match(route, /EXPECTED_ROUNDS = \[56, 32, 16, 8, 4, 2, 1\]/);
  assert.match(route, /FIXTURE_MISSING/);
  assert.match(route, /BRACKET_RESULT_MISMATCH/);
  assert.match(route, /DUPLICATE_FIXTURE_STORAGE_IDS/);
  assert.match(route, /finishedMatches/);
  assert.match(route, /scheduledMatches/);
  assert.match(page, /Кубок Пирамиды · контроль матчей/);
  assert.match(page, /Проблемы целостности/);
});
