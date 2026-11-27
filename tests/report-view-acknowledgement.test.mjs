import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = readFileSync(new URL('../src/app/lib/store.tsx', import.meta.url), 'utf8');
const matchPage = readFileSync(new URL('../src/app/match/page.tsx', import.meta.url), 'utf8');
const reportsPage = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
const matchReportAction = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');

test('view acknowledgement waits for server acceptance before local unread suppression', () => {
  const start = store.indexOf('const markMatchIdAsSeen = useCallback(async');
  assert.notEqual(start, -1);
  const end = store.indexOf('const recordMatch = useCallback', start);
  const block = store.slice(start, end);
  assert.ok(block.indexOf('await markMatchViewedAction(idToken, matchId)') < block.indexOf('rememberViewedMatchId(matchId)'));
  assert.match(block, /result\.persisted !== true/);
  assert.match(block, /return true/);
  assert.match(block, /return false/);
  assert.doesNotMatch(block, /void\s*\(async\s*\(\)/);
});

test('scheduled match previews can exit without acknowledging a report', () => {
  assert.match(matchPage, /isMatchReportFinished/);
  const start = matchPage.indexOf('const handleNext = async');
  const end = matchPage.indexOf('if (isUserLoading', start);
  const handler = matchPage.slice(start, end);
  assert.match(handler, /if \(isMatchReportFinished\(matchData\)\)/);
  assert.ok(handler.indexOf('await markMatchIdAsSeen(viewedId)') < handler.indexOf("router.replace('/')"));
  assert.match(handler, /if \(!acknowledged\)[\s\S]*?return;/);
  assert.match(handler, /Upcoming or scheduled matches may be inspected/);
});

test('server refuses acknowledgements for missing or unfinished report documents', () => {
  const start = matchReportAction.indexOf('export async function markMatchViewedAction');
  const end = matchReportAction.indexOf('/** Authenticated, profile-scoped queue', start);
  const action = matchReportAction.slice(start, end);
  assert.match(action, /if \(!found\) return \{ success: false, error: 'MATCH_NOT_FOUND' \}/);
  assert.match(action, /if \(!isMatchReportFinished\(match\)\)/);
  assert.match(action, /'MATCH_NOT_FINISHED'/);
  assert.doesNotMatch(action, /localOnly: true/);
});

test('finishing a report waits for the viewed acknowledgement before leaving', () => {
  assert.match(matchPage, /const handleNext = async/);
  assert.match(matchPage, /await markMatchIdAsSeen\(viewedId\)/);
  assert.match(matchPage, /disabled=\{isFinalizingReview\}/);
});

test('reports queue excludes locally and server-marked viewed matches', () => {
  assert.match(reportsPage, /!isLocallyViewed\(m\)/);
  assert.match(reportsPage, /m\.seen !== true/);
  assert.match(reportsPage, /m\.reportStatus !== 'viewed'/);
});


test('report lookup, league queue and acknowledgement share every participant identity field', () => {
  const participantHelper = matchReportAction.slice(
    matchReportAction.indexOf('function isMatchReportParticipant'),
    matchReportAction.indexOf('async function isRankBasedLeagueParticipant'),
  );
  const getReport = matchReportAction.slice(
    matchReportAction.indexOf('export async function getMatchReportAction'),
    matchReportAction.indexOf('export async function markMatchViewedAction'),
  );
  const markViewed = matchReportAction.slice(matchReportAction.indexOf('export async function markMatchViewedAction'));
  const leagueReports = matchReportAction.slice(
    matchReportAction.indexOf('export async function getMyLeagueMatchReportsAction'),
    matchReportAction.indexOf('export async function getMyUnreadMatchReportsCountAction'),
  );
  for (const field of ['homeId', 'awayId', 'homeUid', 'awayUid', 'hostId', 'challengerId']) {
    assert.match(participantHelper, new RegExp(`match\\?\\.${field}`));
  }
  assert.match(getReport, /isMatchReportParticipant\(match, uid\)/);
  assert.match(markViewed, /isMatchReportParticipant\(match, uid\)/);
  assert.match(leagueReports, /isMatchReportParticipant\(raw, uid\)/);
  assert.doesNotMatch(leagueReports, /raw\.homeId \|\| raw\.homeUid/);
});

test('view acknowledgement rechecks the reset marker and every report copy in one transaction', () => {
  const start = matchReportAction.indexOf('export async function markMatchViewedAction');
  const end = matchReportAction.indexOf('/** Authenticated, profile-scoped queue', start);
  const action = matchReportAction.slice(start, end);
  assert.ok(action.includes('db.runTransaction(async (tx: any) =>'));
  assert.ok(action.includes('tx.get(configRef)'));
  assert.ok(action.includes('stagingSeasonOneResetInProgress'));
  assert.match(action, /const candidates = MATCH_REPORT_COLLECTIONS\.map/);
  assert.match(action, /candidates\.map\(candidate => tx\.get\(candidate\.ref\)\)/);
  assert.match(action, /matchSnaps\.some\(\(snap: any\) => snap\.exists\)/);
  assert.match(action, /tx\.update\(candidate\.ref/);
  assert.match(action, /updatedCopies: acknowledged\.length/);
  assert.ok(action.indexOf('Promise.all') < action.indexOf('tx.update(candidate.ref'));
  assert.ok(!action.includes('await ref.update('));
});

test('legacy rank-based report access requires exact league, group and division coordinates', () => {
  assert.match(matchReportAction, /async function isRankBasedLeagueParticipant/);
  assert.match(matchReportAction, /collectionName !== MATCH_COLLECTIONS\.league/);
  assert.match(matchReportAction, /profile\.selectedLeagueId \|\| ''\) === leagueId/);
  assert.match(matchReportAction, /profile\.groupId \|\| ''\) === groupId/);
  assert.match(matchReportAction, /Number\(profile\.leagueLevel\) === level/);
  assert.match(matchReportAction, /\[homeRank, awayRank\]\.includes\(Number\(profile\.rank\)\)/);
  assert.match(matchReportAction, /await isRankBasedLeagueParticipant\(db, uid, match, collectionName, profile\)/);
  assert.match(matchReportAction, /await isRankBasedLeagueParticipant\(db, uid, match, candidates\[index\]\.collectionName, profile\)/);
});
