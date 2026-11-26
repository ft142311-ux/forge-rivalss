import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = readFileSync(new URL('../src/app/lib/store.tsx', import.meta.url), 'utf8');
const matchPage = readFileSync(new URL('../src/app/match/page.tsx', import.meta.url), 'utf8');
const reportsPage = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
const matchReportAction = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');

test('view acknowledgement persists locally before awaiting the server', () => {
  const start = store.indexOf('const markMatchIdAsSeen = useCallback(async');
  assert.notEqual(start, -1);
  const end = store.indexOf('const recordMatch = useCallback', start);
  const block = store.slice(start, end);
  assert.ok(block.indexOf('rememberViewedMatchId(matchId)') < block.indexOf('await markMatchViewedAction(idToken, matchId)'));
  assert.match(block, /await markMatchViewedAction\(idToken, matchId\)/);
  assert.doesNotMatch(block, /void\s*\(async\s*\(\)/);
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


test('report loading and viewed acknowledgement recognize every participant identity field', () => {
  const getReport = matchReportAction.slice(matchReportAction.indexOf('export async function getMatchReportAction'), matchReportAction.indexOf('export async function markMatchViewedAction'));
  const markViewed = matchReportAction.slice(matchReportAction.indexOf('export async function markMatchViewedAction'));
  for (const field of ['homeId', 'awayId', 'homeUid', 'awayUid', 'hostId', 'challengerId']) {
    assert.match(getReport, new RegExp(`match\\.${field}`));
    assert.match(markViewed, new RegExp(`m\\.${field}`));
  }
  assert.match(markViewed, /\.some\(\(participantId\) => String\(participantId \|\| ''\) === uid\)/);
});

test('legacy rank-based report access requires exact league, group and division coordinates', () => {
  assert.match(matchReportAction, /async function isRankBasedLeagueParticipant/);
  assert.match(matchReportAction, /collectionName !== MATCH_COLLECTIONS\.league/);
  assert.match(matchReportAction, /profile\.selectedLeagueId \|\| ''\) === leagueId/);
  assert.match(matchReportAction, /profile\.groupId \|\| ''\) === groupId/);
  assert.match(matchReportAction, /Number\(profile\.leagueLevel\) === level/);
  assert.match(matchReportAction, /\[homeRank, awayRank\]\.includes\(Number\(profile\.rank\)\)/);
  assert.match(matchReportAction, /await isRankBasedLeagueParticipant\(db, uid, match, collectionName, profile\)/);
  assert.match(matchReportAction, /await isRankBasedLeagueParticipant\(db, uid, m, collectionName, profile\)/);
});
