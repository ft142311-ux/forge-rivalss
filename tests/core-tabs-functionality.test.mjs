import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const events = readFileSync(new URL('../src/app/events/page.tsx', import.meta.url), 'utf8');
const awards = readFileSync(new URL('../src/app/awards/page.tsx', import.meta.url), 'utf8');
const search = readFileSync(new URL('../src/app/search/page.tsx', import.meta.url), 'utf8');

test('events page loads the authenticated current-season schedule and filters to the manager’s own fixtures', () => {
  assert.match(events, /fetch\('\/api\/league\/matches'/);
  assert.match(events, /Authorization: `Bearer \$\{token\}`/);
  assert.match(events, /selectedLeagueId/);
  assert.match(events, /match\.homeId === user\.uid \|\| match\.awayId === user\.uid/);
  assert.match(events, /Number\(match\.homeRank\) === managerRank/);
  assert.match(events, /Number\(match\.season\) === effectiveSeason/);
  assert.match(events, /isFinished/);
  assert.match(events, /scheduledStartAt/);
  assert.match(events, /seasonDay/);
  assert.doesNotMatch(events, /\bconst\s*\{[^}]*allSeasonMatches/s);
  assert.match(events, /href="\/matches"/);
  assert.match(events, /href="\/tournaments"/);
});

test('awards page renders only recorded club trophies and links to the season leaderboard', () => {
  assert.match(awards, /trophies/);
  assert.match(awards, /records\.length/);
  assert.match(awards, /href="\/rankings\?view=season_top"/);
  assert.match(awards, /No awards yet/);
});

test('search page filters real senior, youth and staff entries without fabricated results', () => {
  assert.match(search, /ownedPlayers/);
  assert.match(search, /youthAcademyPlayers/);
  assert.match(search, /Object\.entries\(staff/);
  assert.match(search, /item\.name, item\.detail, item\.id, item\.kind/);
  assert.match(search, /No matches in your club data/);
  assert.doesNotMatch(search, /Manager_0492/);
});

const news = readFileSync(new URL('../src/app/news/page.tsx', import.meta.url), 'utf8');

test('club news feed is generated from recorded match history and trophies', () => {
  assert.match(news, /matchHistory/);
  assert.match(news, /trophies/);
  assert.match(news, /seriesScore \|\| match\.score/);
  assert.match(news, /href: '\/awards'/);
  assert.match(news, /No club news yet/);
});
