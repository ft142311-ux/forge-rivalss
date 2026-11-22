import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resolver = readFileSync(new URL('../src/app/actions/universal-match-resolver.ts', import.meta.url), 'utf8');

test('Cup Match Core uses the frozen roster snapshot when the live bot profile has been retired', () => {
  assert.match(resolver, /collectionName === 'cup_matches'/);
  assert.match(resolver, /match\.homeTeamSnapshot\?\.id === String\(homeId\)/);
  assert.match(resolver, /match\.awayTeamSnapshot\?\.id === String\(awayId\)/);
  assert.match(resolver, /match\.homeTeamSnapshot\.players\.length === 5/);
  assert.match(resolver, /match\.awayTeamSnapshot\.players\.length === 5/);
  assert.match(resolver, /if \(\(!homeSnap\.exists && !frozenCupHome\) \|\| \(!awaySnap\.exists && !frozenCupAway\)\)/);
  assert.match(resolver, /teamA: homeTeamSnapshot/);
  assert.match(resolver, /teamB: awayTeamSnapshot/);
});

test('Only Cup fixtures may use frozen participant snapshots; other match modes still require live profiles', () => {
  const start = resolver.indexOf('const frozenCupHome');
  const end = resolver.indexOf('const simulation = runMatchEngine', start);
  assert.ok(start >= 0 && end > start);
  const boundary = resolver.slice(start, end);
  assert.equal((boundary.match(/collectionName === 'cup_matches'/g) || []).length, 2);
  assert.match(boundary, /buildMatchTeamSnapshot\(homeData, homeName, String\(homeId\), matchType\)/);
  assert.match(boundary, /buildMatchTeamSnapshot\(awayData, awayName, String\(awayId\), matchType\)/);
});
