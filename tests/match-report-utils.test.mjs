import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getCompletedSeriesScore,
  isMatchReportFinished,
  isMatchWithinClubLifetime,
  normalizeMatchTimeline,
  parseMatchSeriesScore,
  resolveMatchSimulation,
} from '../src/app/lib/match-report-utils.ts';
import { createFreshSeasonOneHumanClubProfile } from '../src/app/actions/fresh-season-one-player-reset.ts';

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
  assert.match(action, /getMyUnreadMatchReportsCountAction/);
  assert.match(action, /Number\(raw\.level\) === level && String\(raw\.groupId \|\| ''\) === groupId/);
  assert.match(action, /\[Number\(raw\.homeRank\), Number\(raw\.awayRank\)\]\.includes\(rank\)/);
  assert.match(action, /isMatchReportFinished\(raw\)/);
});


test('viewed league reports are excluded from server unread count', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  assert.match(action, /raw\.seen === true \|\| raw\.reportStatus === 'viewed'/);
});

test('home menu displays the unread match-report count on the Match Review item', () => {
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  assert.match(home, /getMyUnreadMatchReportsCountAction/);
  assert.match(home, /serverUnreadReportsCount/);
  assert.match(home, /id: 'reports'.*href: '\/reports'.*badge:/);
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
  assert.match(home, /getMyUnreadMatchReportsCountAction/);
  assert.match(home, /serverUnreadReportsCount/);
  assert.doesNotMatch(topBar, /unreadReportsCount|serverUnreadReports|getMyUnreadMatchReportsCountAction/);
  assert.match(topBar, /href="\/notifications"/);
});


test('club lifetime cutoff rejects recycled-slot fixtures scheduled before registration', () => {
  const profileCreatedAt = '2026-11-10T10:00:00.000Z';
  assert.equal(isMatchWithinClubLifetime({
    startTime: '2026-11-09T10:00:00.000Z',
    resolvedAt: '2026-11-11T10:00:00.000Z',
  }, profileCreatedAt), false);
  assert.equal(isMatchWithinClubLifetime({
    startTime: '2026-11-10T10:00:00.000Z',
  }, profileCreatedAt), true);
  assert.equal(isMatchWithinClubLifetime({
    playedAt: { seconds: 1794304800, nanoseconds: 0 },
  }, profileCreatedAt), true);
  assert.equal(isMatchWithinClubLifetime({ startTime: 'invalid' }, profileCreatedAt), false);
  assert.equal(isMatchWithinClubLifetime({ startTime: '2026-11-01T10:00:00.000Z' }, null), true);
});

test('fresh Season 1 club profiles establish a lifetime cutoff for recycled-slot reports', () => {
  const createdAt = new Date('2026-11-20T15:00:00.000Z');
  const profile = createFreshSeasonOneHumanClubProfile(
    { id: 'human-club-uid', email: 'manager@example.invalid' },
    { tier: 2, group: 1, rank: 3 },
    1,
    createdAt,
  );
  assert.equal(profile.createdAt, createdAt.toISOString());
  assert.equal(isMatchWithinClubLifetime({
    startTime: '2026-11-19T15:00:00.000Z',
    resolvedAt: '2026-11-21T15:00:00.000Z',
  }, profile.createdAt), false);
  assert.equal(isMatchWithinClubLifetime({
    startTime: '2026-11-20T15:00:00.000Z',
  }, profile.createdAt), true);
});

test('server report reads, acknowledgements and unread counts enforce the current club lifetime', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  const unreadCount = readFileSync(new URL('../src/app/lib/unread-match-report-count.ts', import.meta.url), 'utf8');
  assert.match(action, /isMatchWithinClubLifetime\(match, profile\.createdAt\)/);
  assert.match(action, /isMatchWithinClubLifetime\(raw, profile\.createdAt\)/);
  assert.match(unreadCount, /isMatchWithinClubLifetime\(match, profileCreatedAt\)/);
  assert.match(action, /return \{ success: false, error: 'MATCH_ACCESS_DENIED' \}/);
});

test('unread report queue and home badge exclude local history from a prior club lifetime', () => {
  const reports = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  assert.match(reports, /isMatchWithinClubLifetime\(m, profile\.createdAt\)/);
  assert.match(reports, /if \(!user \|\| !rank \|\| !profile\) return \[\]/);
  assert.match(home, /isMatchWithinClubLifetime\(m, profile\.createdAt\)/);
});

test('match player does not fall back to a report from a prior club lifetime', () => {
  const page = readFileSync(new URL('../src/app/match/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /isMatchWithinClubLifetime\(localCandidate, profile\.createdAt\)/);
  assert.match(page, /response\.error === 'MATCH_ACCESS_DENIED' \? null/);
});


test('friendly and association report subscriptions are scoped to the current club lifetime', () => {
  const reports = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
  assert.match(reports, /isMatchWithinClubLifetime\(m, profile\.createdAt\).*friendly/);
  assert.match(reports, /isMatchWithinClubLifetime\(m, profile\.createdAt\).*basket/);
});


test('match report completion accepts explicit and terminal status variants consistently', () => {
  assert.equal(isMatchReportFinished({ isFinished: true, status: 'scheduled' }), true);
  assert.equal(isMatchReportFinished({ isFinished: false, status: 'finished' }), true);
  assert.equal(isMatchReportFinished({ status: 'COMPLETED' }), true);
  assert.equal(isMatchReportFinished({ status: 'resolved' }), true);
  assert.equal(isMatchReportFinished({ isFinished: false, status: 'scheduled' }), false);
  assert.equal(isMatchReportFinished({}), false);
});

test('reports queue uses the shared completion predicate for every game mode', () => {
  const page = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /isMatchReportFinished\(m\)/);
  assert.doesNotMatch(page, /m\?\.isFinished === true|m\?\.isFinished !== false/);
});

test('view acknowledgement updates every existing authorized report copy without recreating deleted documents', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  assert.match(action, /const candidates = MATCH_REPORT_COLLECTIONS\.map/);
  assert.match(action, /candidates\.map\(candidate => tx\.get\(candidate\.ref\)\)/);
  assert.match(action, /tx\.update\(candidate\.ref, \{\s*seen: true/);
  assert.match(action, /persisted: false, localOnly: true/);
  assert.doesNotMatch(action, /await ref\.set\(\{\s*seen: true/);
});

test('all Beta game mutation paths honor either fresh Season 1 reset marker', () => {
  const guardedPaths = [
    '../src/app/actions/cup-engine.ts',
    '../src/app/actions/tournament-system.ts',
    '../src/app/actions/match-report.ts',
    '../src/app/actions/season-cycle.ts',
    '../src/app/actions/universal-match-resolver.ts',
    '../src/app/api/registration/initialize/route.ts',
    '../src/app/lib/auction-expiry-sweep.ts',
    '../src/app/actions/autonomous-cycle.ts',
    '../src/app/actions/season-init.ts',
    '../src/app/actions/season-calendar.ts',
    '../src/app/actions/season-rollover-lock.ts',
  ];
  for (const relativePath of guardedPaths) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /stagingSeasonOneResetInProgress === true/, relativePath);
    assert.match(source, /stagingFreshSeasonOneReset === true/, relativePath);
  }
});

test('Universal Match Core and Pyramid Cup share the terminal match-report predicate', () => {
  const universal = readFileSync(new URL('../src/app/actions/universal-match-resolver.ts', import.meta.url), 'utf8');
  const cup = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');
  assert.match(universal, /isMatchReportFinished\(match\)/);
  assert.match(cup, /isMatchReportFinished\(match\)/);
  assert.equal(isMatchReportFinished({ isFinished: false, status: 'resolved' }), true);
});
