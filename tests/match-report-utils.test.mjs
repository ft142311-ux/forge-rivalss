import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getCompletedSeriesScore,
  normalizeMatchTimeline,
  parseMatchSeriesScore,
  resolveMatchSimulation,
} from '../src/app/lib/match-report-utils.ts';

test('resolveMatchSimulation preserves stored simulation and legacy fallback shape', () => {
  const simulation = { games: [{ homeScore: 1 }], seriesScore: '1-0' };
  assert.equal(resolveMatchSimulation({ simulation }), simulation);
  assert.deepEqual(resolveMatchSimulation({ scoreA: 2, scoreB: 1, winner: 'Home' }), {
    games: [{ scoreA: 2, scoreB: 1, winner: 'Home' }],
    seriesScore: '2-1',
    winner: 'Home',
    isTbdWin: undefined,
  });
  assert.equal(resolveMatchSimulation(null), null);
});

test('parseMatchSeriesScore supports object, string and legacy score fields', () => {
  assert.deepEqual(parseMatchSeriesScore({ homeScore: 2, awayScore: 1 }, {}), { home: 2, away: 1 });
  assert.deepEqual(parseMatchSeriesScore('2–1', {}), { home: 2, away: 1 });
  assert.deepEqual(parseMatchSeriesScore(undefined, { scoreA: 1, awayScore: 2 }), { home: 1, away: 2 });
});

test('normalizeMatchTimeline preserves source fields and normalizes legacy event shapes', () => {
  assert.deepEqual(normalizeMatchTimeline({ timeline: [
    { time: '03:00', description: 'First blood', score: '1:0', extra: true },
    'Tower destroyed',
    null,
    { minute: '10:00', message: 'Dragon secured' },
    { text: '' },
  ] }), [
    { time: '03:00', description: 'First blood', score: '1:0', extra: true, minute: '03:00', text: 'First blood' },
    { text: 'Tower destroyed', minute: '2:00' },
    { minute: '10:00', message: 'Dragon secured', text: 'Dragon secured' },
  ]);
});

test('getCompletedSeriesScore sums only completed maps and safely handles missing data', () => {
  const games = [{ homeScore: 1, awayScore: 0 }, { homeScore: 0, awayScore: 1 }, { homeScore: 1, awayScore: 0 }];
  assert.deepEqual(getCompletedSeriesScore(games, 2), { home: 1, away: 1 });
  assert.deepEqual(getCompletedSeriesScore(games, 3), { home: 2, away: 1 });
  assert.deepEqual(getCompletedSeriesScore(null, 2), { home: 0, away: 0 });
});


test('reports page loads finished league reports through authenticated profile-scoped action', () => {
  const page = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /getMyLeagueMatchReportsAction\(await user\.getIdToken\(\)\)/);
  assert.match(page, /const personal = \[\.\.\.officialLeagueReports/);
  assert.match(page, /officialLeagueReports, personalHomeMatches/);
});

test('server report lookup restricts rank-based matches to the authenticated profile league group', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  assert.match(action, /getMyLeagueMatchReportsAction/);
  assert.match(action, /Number\(raw\.level\) === level && String\(raw\.groupId \|\| ''\) === groupId/);
  assert.match(action, /\[Number\(raw\.homeRank\), Number\(raw\.awayRank\)\]\.includes\(rank\)/);
  assert.match(action, /raw\.isFinished === true/);
});


test('viewed league reports are excluded from server unread count', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  assert.match(action, /raw\.seen === true \|\| raw\.reportStatus === 'viewed'/);
});

test('top bar displays a count for unread match reports', () => {
  const topBar = readFileSync(new URL('../src/components/game/TopBar.tsx', import.meta.url), 'utf8');
  assert.match(topBar, /getMyLeagueMatchReportsAction/);
  assert.match(topBar, /unreadReportsCount > 0/);
  assert.match(topBar, /serverUnreadReports/);
});

test('pyramid cup is not listed in tournament hub because it lives in rankings', () => {
  const tournaments = readFileSync(new URL('../src/app/tournaments/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(tournaments, /id: 'pyramid'/);
  const rankings = readFileSync(new URL('../src/app/rankings/page.tsx', import.meta.url), 'utf8');
  assert.match(rankings, /id: 'cup'.*Кубок Пирамиды/);
});


test('unread match count is shown on Match Review menu item, not the general notifications bell', () => {
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const topBar = readFileSync(new URL('../src/components/game/TopBar.tsx', import.meta.url), 'utf8');
  assert.match(home, /getMyLeagueMatchReportsAction/);
  assert.match(home, /serverUnreadReportsCount/);
  assert.doesNotMatch(topBar, /unreadReportsCount|serverUnreadReports|getMyLeagueMatchReportsAction/);
  assert.match(topBar, /href="\/notifications"/);
});


test('new clubs do not inherit league reports from before profile creation', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  assert.match(action, /matchBelongsToClubLifetime\(raw, profile\.createdAt\)/);
  assert.match(action, /const matchAt = timestampMillis\(match\.startTime \|\| match\.playedAt \|\| match\.resolvedAt\)/);
  assert.match(action, /return matchAt > 0 && matchAt >= createdAt/);
});
