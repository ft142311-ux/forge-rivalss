import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getCompletedSeriesScore,
  hasValidClubCreatedAt,
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

test('home header exposes the unread report count on the report-specific link', () => {
  const topBar = readFileSync(new URL('../src/components/game/TopBar.tsx', import.meta.url), 'utf8');
  assert.match(topBar, /getMyUnreadMatchReportsCountAction/);
  assert.match(topBar, /href="\/reports"[\s\S]*?unreadReportsCount/);
});

test('pyramid cup is not listed in tournament hub because it lives in rankings', () => {
  const tournaments = readFileSync(new URL('../src/app/tournaments/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(tournaments, /id: 'pyramid'/);
  const rankings = readFileSync(new URL('../src/app/rankings/page.tsx', import.meta.url), 'utf8');
  assert.match(rankings, /id: 'cup'.*Кубок Пирамиды/);
});


test('unread match count stays on Reports and does not become a general notification badge', () => {
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const topBar = readFileSync(new URL('../src/components/game/TopBar.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /getMyUnreadMatchReportsCountAction|serverUnreadReportsCount/);
  const notificationsLink = topBar.match(/<Link href="\/notifications"[\s\S]*?<\/Link>/);
  assert.ok(notificationsLink, 'general notifications link must remain available');
  assert.match(notificationsLink[0], /Bell/);
  assert.doesNotMatch(notificationsLink[0], /unreadReportsCount/);
  const reportsLink = topBar.match(/<Link href="\/reports"[\s\S]*?<\/Link>/);
  assert.ok(reportsLink, 'reports link must remain available');
  assert.match(reportsLink[0], /Mail/);
  assert.match(reportsLink[0], /unreadReportsCount/);
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
  assert.equal(hasValidClubCreatedAt(profileCreatedAt), true);
  assert.equal(hasValidClubCreatedAt({ seconds: 0, nanoseconds: 0 }), false);
  assert.equal(hasValidClubCreatedAt(null), false);
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
  assert.match(action, /!participant && hasValidClubCreatedAt\(profile\.createdAt\)/);
  assert.match(action, /const rankParticipant = !participant && hasValidClubCreatedAt\(profile\.createdAt\) &&\s*inGroup/);
  assert.match(action, /isMatchWithinClubLifetime\(raw, profile\.createdAt\)/);
  assert.match(unreadCount, /isMatchWithinClubLifetime\(match, profileCreatedAt\)/);
  assert.match(action, /return \{ success: false, error: 'MATCH_ACCESS_DENIED' \}/);
});

test('unread report queue and header badge exclude local history from a prior club lifetime', () => {
  const reports = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const topBar = readFileSync(new URL('../src/components/game/TopBar.tsx', import.meta.url), 'utf8');
  const unreadCount = readFileSync(new URL('../src/app/lib/unread-match-report-count.ts', import.meta.url), 'utf8');
  assert.match(reports, /isMatchWithinClubLifetime\(m, profile\.createdAt\)/);
  assert.match(reports, /if \(!user \|\| !rank \|\| !profile\) return \[\]/);
  assert.match(topBar, /getMyUnreadMatchReportsCountAction/);
  assert.match(unreadCount, /isMatchWithinClubLifetime\(match, profileCreatedAt\)/);
  assert.doesNotMatch(home, /isMatchWithinClubLifetime|profile\.createdAt/);
  assert.match(home, /!isMatchReportFinished\(m\)/);
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
  assert.match(action, /persisted: true/);
  assert.match(action, /MATCH_NOT_FINISHED/);
  assert.match(action, /MATCH_NOT_FOUND/);
  assert.doesNotMatch(action, /localOnly: true/);
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


test('match report lookup prefers a completed canonical copy over an unfinished legacy mirror', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  assert.match(action, /Promise\.all\(MATCH_REPORT_COLLECTIONS\.map/);
  assert.match(action, /isCanonicalMatchReportCopy/);
  assert.match(action, /Number\(isMatchReportFinished\(right\.match\)\) - Number\(isMatchReportFinished\(left\.match\)\)/);
  assert.match(action, /Number\(isCanonicalMatchReportCopy\(right\.collectionName, right\.match\)\)/);
});


test('home dashboard keeps its live clock and renders the computed season transition state', () => {
  const home = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  assert.match(home, /setInterval\(\(\) => setNow\(getMoscowTime\(\)\), 1000\)/);
  assert.match(home, /const cardCountdown = showOffseason/);
  assert.match(home, /const cardTitle = showOffseason/);
  assert.match(home, /\{cardTitle\}/);
  assert.match(home, /\{cardStatusLabel\}/);
  assert.match(home, /showOffseason \? "\/roster" : "\/matches"/);
  assert.match(home, /toMillis\(a\.startTime\)/);
  assert.doesNotMatch(home, /groupPlayers/);
});


test('league report queue and unread badge retain unviewed reports across season boundaries', () => {
  const action = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');
  const queueStart = action.indexOf('export async function getMyLeagueMatchReportsAction');
  const badgeStart = action.indexOf('export async function getMyUnreadMatchReportsCountAction');
  const queue = action.slice(queueStart, badgeStart);
  const badge = action.slice(badgeStart);

  assert.match(queue, /const participantFields = \['homeId', 'awayId', 'homeUid', 'awayUid', 'hostId', 'challengerId'\]/);
  assert.match(queue, /where\('season', '==', season\)/);
  assert.match(queue, /where\('leagueId', '==', leagueId\)/);
  assert.match(queue, /participantFields\.map\(field =>\s*db\.collection\(MATCH_COLLECTIONS\.league\)\.where\(field, '==', uid\)\.get\(\)/);
  assert.match(queue, /isMatchReportParticipant\(raw, uid\)/);
  assert.match(queue, /isMatchWithinClubLifetime\(raw, profile\.createdAt\)/);

  assert.match(badge, /where\('season', '==', season\)/);
  assert.match(badge, /where\('leagueId', '==', league\.leagueId\)/);
  assert.match(badge, /countUnreadMatchReportRecords\(/);
  assert.match(badge, /{ collectionName: MATCH_COLLECTIONS\.league, field: 'hostId' }/);
  assert.match(badge, /{ collectionName: MATCH_COLLECTIONS\.league, field: 'challengerId' }/);
});

test('league report queue does not discard completed legacy results solely because resolvedAt is absent', () => {
  const page = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
  const start = page.indexOf('const league = currentClubPersonal');
  const end = page.indexOf('const cup = currentClubPersonal', start);
  const leagueFilter = page.slice(start, end);
  assert.match(page, /const currentClubPersonal = personal\.filter\(\(m: any\) => isMatchWithinClubLifetime\(m, profile\.createdAt\)\)/);
  assert.match(leagueFilter, /isMatchReportFinished\(m\)/);
  assert.match(leagueFilter, /\.filter\(\(m: any\) => m\.seen !== true && m\.reportStatus !== 'viewed' && !isLocallyViewed\(m\)\)/);
  assert.doesNotMatch(leagueFilter, /const resolved|regTime/);
});
