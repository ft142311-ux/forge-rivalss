import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../src/app/api/diagnostics/league-table/route.ts', import.meta.url), 'utf8');
const rankings = readFileSync(new URL('../src/app/rankings/page.tsx', import.meta.url), 'utf8');

test('league access diagnostics verify identity and inspect only the caller retirement markers', () => {
  assert.match(route, /getAuth\(\)\.verifyIdToken\(tokenMatch\[1\], true\)/);
  assert.match(route, /inactive_club_retirements_v1/);
  assert.match(route, /inactive_clubs_v1/);
  assert.match(route, /league_tables_v2/);
  assert.match(route, /firestore\.googleapis\.com/);
  assert.match(route, /Authorization:/);
  assert.match(route, /tokenMatch\[1\]/);
  assert.match(route, /rulesProbe/);
  assert.doesNotMatch(route, /requireServerActor/);
  assert.match(route, /pendingRetirement:\s*pendingMarker\.exists/);
  assert.match(route, /retired:\s*retiredMarker\.exists/);
});

test('standings permission failures trigger the authenticated read-only diagnostic', () => {
  assert.match(rankings, /api\/diagnostics\/league-table/);
  assert.match(rankings, /Authorization/);
});
