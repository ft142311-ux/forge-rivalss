import test from 'node:test';
import assert from 'node:assert/strict';
import { countUnreadMatchReportRecords } from '../src/app/lib/unread-match-report-count.ts';
import { MATCH_COLLECTIONS } from '../src/app/lib/match-storage.ts';

const uid = 'manager-1';
const createdAt = new Date('2026-01-01T00:00:00.000Z');
const league = { leagueId: 'ALPHA', level: 2, groupId: 'G1', rank: 3 };
const finishedAt = new Date('2026-02-01T00:00:00.000Z');
const record = (collectionName, id, match = {}) => ({
  collectionName, id,
  match: { id, isFinished: true, startTime: finishedAt, ...match },
});

test('unread badge counts completed reports from every game mode exactly once', () => {
  const records = [
    record(MATCH_COLLECTIONS.league, 'league-1', { homeId: uid }),
    record(MATCH_COLLECTIONS.cup, 'cup-1', { awayId: uid }),
    record(MATCH_COLLECTIONS.friendly, 'friendly-1', { hostId: uid }),
    record(MATCH_COLLECTIONS.association, 'cw-1', { challengerId: uid }),
    record(MATCH_COLLECTIONS.tournament, 'tournament-1', { homeId: uid }),
    record(MATCH_COLLECTIONS.trial, 'trial-1', { awayId: uid }),
    record(MATCH_COLLECTIONS.league, 'league-1', { homeId: uid }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league), 6);
});

test('legacy rank-based league reports require the exact league group and division', () => {
  const records = [
    record(MATCH_COLLECTIONS.league, 'rank-match', {
      leagueId: 'ALPHA', level: 2, groupId: 'G1', homeRank: 3, awayRank: 4,
    }),
    record(MATCH_COLLECTIONS.league, 'wrong-group', {
      leagueId: 'ALPHA', level: 2, groupId: 'G2', homeRank: 3, awayRank: 4,
    }),
    record(MATCH_COLLECTIONS.league, 'wrong-division', {
      leagueId: 'ALPHA', level: 3, groupId: 'G1', homeRank: 3, awayRank: 4,
    }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league), 1);
});

test('viewed, unfinished, pre-registration and foreign reports are excluded', () => {
  const records = [
    record(MATCH_COLLECTIONS.cup, 'viewed', { homeId: uid, seen: true }),
    record(MATCH_COLLECTIONS.cup, 'viewed-status', { awayId: uid, reportStatus: 'viewed' }),
    record(MATCH_COLLECTIONS.tournament, 'unfinished', { homeId: uid, isFinished: false, status: 'scheduled' }),
    record(MATCH_COLLECTIONS.friendly, 'old', { hostId: uid, startTime: new Date('2025-12-31T23:59:59.000Z') }),
    record(MATCH_COLLECTIONS.association, 'foreign', { hostId: 'another-manager' }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league), 0);
});

test('finished status variants are accepted without requiring isFinished boolean', () => {
  const records = [
    record(MATCH_COLLECTIONS.tournament, 'resolved', { homeId: uid, isFinished: false, status: 'resolved' }),
    record(MATCH_COLLECTIONS.cup, 'completed', { awayId: uid, isFinished: false, status: 'completed' }),
    record(MATCH_COLLECTIONS.league, 'league-resolved', { homeId: uid, isFinished: false, status: 'resolved' }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league), 3);
});

test('a report mirrored across mode collections is counted once by its route ID', () => {
  const records = [
    record(MATCH_COLLECTIONS.league, 'shared-report', { homeId: uid }),
    record(MATCH_COLLECTIONS.cup, 'shared-report', { awayId: uid }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league), 1);
});

test('locally acknowledged report IDs suppress stale server badge entries across all collections', () => {
  const records = [
    record(MATCH_COLLECTIONS.league, 'local-viewed', { homeId: uid }),
    record(MATCH_COLLECTIONS.cup, 'still-unread', { awayId: uid }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league, ['local-viewed']), 1);
});

test('unread badge recognizes a manager UID even when legacy club identity fields differ', () => {
  const records = [
    record(MATCH_COLLECTIONS.cup, 'uid-fallback', {
      homeId: 'legacy-club-id',
      homeUid: ' manager-1 ',
    }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, uid, createdAt, league), 1);
});

test('unread badge rejects blank manager identities', () => {
  const records = [
    record(MATCH_COLLECTIONS.cup, 'foreign-to-blank', { homeId: uid }),
  ];
  assert.equal(countUnreadMatchReportRecords(records, '   ', createdAt, league), 0);
});
