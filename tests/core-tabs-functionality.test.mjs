import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const events = readFileSync(new URL('../src/app/events/page.tsx', import.meta.url), 'utf8');
const awards = readFileSync(new URL('../src/app/awards/page.tsx', import.meta.url), 'utf8');
const search = readFileSync(new URL('../src/app/search/page.tsx', import.meta.url), 'utf8');

test('events page uses the current season fixture data and links to official match and tournament areas', () => {
  assert.match(events, /allSeasonMatches/);
  assert.match(events, /isFinished !== true/);
  assert.match(events, /startTime \?\? match\.scheduledAt \?\? match\.date/);
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
