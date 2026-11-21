import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/matches/page.tsx', import.meta.url), 'utf8');

test('match center maps completed league fixtures to the current owner of the exact season slot', () => {
  assert.match(source, /clubName: myClubName/);
  assert.match(source, /m\.leagueId === selectedLeagueId/);
  assert.match(source, /Number\(m\.level\) === Number\(leagueLevel\)/);
  assert.match(source, /Number\(m\.groupId\) === Number\(groupId\)/);
  assert.match(source, /Number\(m\.season\) === Number\(seasonNumber\)/);
  assert.match(source, /isMyLeagueFixture && Number\(m\.homeRank\) === Number\(rank\)/);
  assert.match(source, /isMyLeagueFixture && Number\(m\.awayRank\) === Number\(rank\)/);
  assert.match(source, /isMyHome && myClubName\s*\?\s*myClubName/);
  assert.match(source, /isMyAway && myClubName\s*\?\s*myClubName/);
});

test('match center keeps UID ownership for non-league fixtures and never renames the opponent', () => {
  const start = source.indexOf('const resolveMatchData = useCallback');
  const end = source.indexOf('const renderMatchCard', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /m\.homeId === user\.uid/);
  assert.match(resolver, /m\.awayId === user\.uid/);
  assert.match(resolver, /isMyLeagueFixture && Number\(m\.homeRank\) === Number\(rank\)/);
  assert.match(resolver, /isMyLeagueFixture && Number\(m\.awayRank\) === Number\(rank\)/);
  assert.match(resolver, /: nameMap\.names\[hRank\] \|\| m\.homeName/);
  assert.match(resolver, /: nameMap\.names\[aRank\] \|\| m\.awayName/);
});

test('match card highlighting uses the same resolved ownership as the displayed club name', () => {
  assert.match(source, /isMyHomeClub: isMyHome, isMyAwayClub: isMyAway/);
  const start = source.indexOf('const renderMatchCard = useCallback');
  const end = source.indexOf('const renderGrouped', start);
  assert.ok(start >= 0 && end > start);
  const renderer = source.slice(start, end);
  assert.match(renderer, /const isMeHome = m\.isMyHomeClub === true/);
  assert.match(renderer, /const isMeAway = m\.isMyAwayClub === true/);
  assert.doesNotMatch(renderer, /Number\(m\.homeRank\) === Number\(myRank\)/);
  assert.doesNotMatch(renderer, /Number\(m\.awayRank\) === Number\(myRank\)/);
});
