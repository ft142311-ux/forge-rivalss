import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = readFileSync(new URL('../src/app/lib/store.tsx', import.meta.url), 'utf8');
const matchPage = readFileSync(new URL('../src/app/match/page.tsx', import.meta.url), 'utf8');
const reportsPage = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');

test('view acknowledgement persists locally before awaiting the server', () => {
  const start = store.indexOf('const markMatchIdAsSeen = useCallback(async');
  assert.notEqual(start, -1);
  const end = store.indexOf('const recordMatch = useCallback', start);
  const block = store.slice(start, end);
  assert.ok(block.indexOf('rememberViewedMatchId(matchId)') < block.indexOf('await markMatchViewedAction(idToken, matchId)'));
  assert.match(block, /await markMatchViewedAction\(idToken, matchId\)/);
  assert.doesNotMatch(block, /void\s*\(async\s*\(\)/);
});

test('finishing a report waits for the viewed acknowledgement before leaving', () => {
  assert.match(matchPage, /const handleNext = async/);
  assert.match(matchPage, /await markMatchIdAsSeen\(viewedId\)/);
  assert.match(matchPage, /disabled=\{isFinalizingReview\}/);
});

test('reports queue excludes locally and server-marked viewed matches', () => {
  assert.match(reportsPage, /!isLocallyViewed\(m\)/);
  assert.match(reportsPage, /m\.seen !== true/);
  assert.match(reportsPage, /m\.reportStatus !== 'viewed'/);
});
