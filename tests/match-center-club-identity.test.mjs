import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/matches/page.tsx', import.meta.url), 'utf8');

test('match center prefers the authenticated club name when a fixture has a stale slot-owner snapshot', () => {
  assert.match(source, /clubName: myClubName/);
  assert.match(source, /const isMyHome = Boolean\(user\?\.uid && m\.homeId === user\.uid\)/);
  assert.match(source, /const isMyAway = Boolean\(user\?\.uid && m\.awayId === user\.uid\)/);
  assert.match(source, /isMyHome && myClubName\s*\?\s*myClubName/);
  assert.match(source, /isMyAway && myClubName\s*\?\s*myClubName/);
});

test('match center never uses the current manager name to overwrite the opponent', () => {
  const start = source.indexOf('const resolveMatchData = useCallback');
  const end = source.indexOf('const renderMatchCard', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /m\.homeId === user\.uid/);
  assert.match(resolver, /m\.awayId === user\.uid/);
  assert.doesNotMatch(resolver, /Number\(m\.homeRank\).*myClubName/);
  assert.doesNotMatch(resolver, /Number\(m\.awayRank\).*myClubName/);
});
