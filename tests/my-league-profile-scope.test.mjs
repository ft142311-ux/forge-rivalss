import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/app/rankings/page.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/api/league/table/route.ts', import.meta.url), 'utf8');

test('My League always resolves its table from the authenticated manager profile', () => {
  assert.match(page, /scope: activeTab === 'my_league' \? 'mine' : 'browse'/);
  assert.match(route, /body\?\.scope === 'mine'/);
  assert.match(route, /ownProfile\?\.leagueLevel/);
  assert.match(route, /ownProfile\?\.groupId/);
  assert.match(route, /ownProfile\?\.selectedLeagueId/);
});

test('My League diagnostics verify that the authenticated UID owns a standings row', () => {
  assert.match(route, /stats\[actor\.uid\]/);
  assert.match(route, /standingsEntryPresent: Boolean\(viewerEntry\)/);
});


test('rankings menu does not render a stale league group after leaving My League', () => {
  assert.match(page, /\(activeTab === 'my_league' \|\| \(\(activeTab === 'my_pyramid' \|\| activeTab === 'all_pyramids'\) && navGroup !== null\)\)/);
  assert.match(page, /if \(activeTab === 'my_league' \|\| activeTab === 'cup'\) \{\s*setActiveTab\('menu'\);\s*setNavLeague\(null\); setNavLevel\(null\); setNavGroup\(null\);/);
});


test('league calendar accepts Firebase bearer tokens and exposes the authenticated group', () => {
  const matchesRoute = readFileSync(new URL('../src/app/api/league/matches/route.ts', import.meta.url), 'utf8');
  assert.match(matchesRoute, /match\(\/\^Bearer \(\\S\+\)\$\//);
  assert.match(matchesRoute, /requireServerActor\(token\)/);
  assert.match(matchesRoute, /LEAGUE_SCOPE_MISMATCH/);
});

test('home next-opponent card loads official fixtures instead of relying only on local cached state', () => {
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  assert.match(home, /fetch\('\/api\/league\/matches'/);
  assert.match(home, /officialLeagueMatches \?\? allSeasonMatches/);
  assert.match(home, /myNext\.awayName : myNext\.homeName/);
});

test('rankings menu uses hydrated profile league coordinates when direct profile reads are unavailable', () => {
  assert.match(page, /selectedLeagueId: storeLeagueId, leagueLevel: storeLeagueLevel, groupId: storeGroupId/);
  assert.match(page, /storeLeagueLevel \|\| profile\?\.leagueLevel/);
  assert.match(page, /storeGroupId \|\| profile\?\.groupId/);
});
