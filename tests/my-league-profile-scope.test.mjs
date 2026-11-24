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
