import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup refuses a league table with a missing participant rank', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  assert.ok(start >= 0 && end > start);
  const loader = source.slice(start, end);
  assert.match(loader, /CUP_LEAGUE_STANDING_MISSING/);
  assert.match(loader, /if \(!entry\)/);
  assert.match(loader, /teams\.push\(normalizeTeam/);
});

test('Pyramid Cup refuses duplicate standings ranks instead of silently selecting one club', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  const loader = source.slice(start, end);
  assert.match(loader, /byRank\.has\(rank\)/);
  assert.match(loader, /CUP_DUPLICATE_LEAGUE_STANDING/);
});

test('Pyramid Cup verifies that standings row identity matches its document key', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  const loader = source.slice(start, end);
  assert.match(loader, /String\(value\?\.id \|\| key\)/);
  assert.match(loader, /rowId !== key/);
  assert.match(loader, /CUP_LEAGUE_STANDING_IDENTITY_INVALID/);
});

test('Pyramid Cup never fabricates a bot participant for an absent standings row', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  const loader = source.slice(start, end);
  assert.doesNotMatch(loader, /normalizeTeam\(byRank\.get\(rank\)/);
  assert.match(loader, /CUP_LEAGUE_STANDING_MISSING/);
});

test('Pyramid Cup freezes five-player participant snapshots at generation', () => {
  assert.match(source, /buildMatchTeamSnapshot/);
  assert.match(source, /CUP_PARTICIPANT_PROFILE_MISSING/);
  assert.match(source, /CUP_PARTICIPANT_ROSTER_INVALID/);
  assert.match(source, /matchSnapshot/);
  assert.match(source, /homeTeamSnapshot: pairing\.home!\.matchSnapshot/);
  assert.match(source, /awayTeamSnapshot: pairing\.away!\.matchSnapshot/);
});

test('prepared Cup verification rejects fixtures without matching frozen participant snapshots', () => {
  const start = source.indexOf('export async function preparePyramidCupForSeason');
  const end = source.indexOf('async function loadCup', start);
  const preparation = source.slice(start, end);
  assert.match(preparation, /CUP_PREPARED_FIXTURE_SNAPSHOT_INVALID/);
  assert.match(preparation, /homeSnapshot\?\.id !== pairing\.home\.id/);
  assert.match(preparation, /awaySnapshot\?\.id !== pairing\.away\.id/);
  assert.match(preparation, /homeSnapshot\.players\.length !== 5/);
  assert.match(preparation, /awaySnapshot\.players\.length !== 5/);
});

test('Pyramid Cup stores frozen rosters separately so bracket documents retain only public participant metadata', () => {
  assert.match(source, /CUP_PARTICIPANT_SNAPSHOT_COLLECTION = 'cup_participant_snapshots_v1'/);
  assert.match(source, /function participantSnapshotRef/);
  assert.match(source, /tx\.create\(snapshot\.ref, snapshot\.data\)/);
  assert.match(source, /function publicPairing/);
  assert.match(source, /first\.map\(publicPairing\)/);
  assert.match(source, /pairings\.map\(publicPairing\)/);
  assert.match(source, /nextPairings\.map\(publicPairing\)/);
  assert.match(source, /CUP_PARTICIPANT_SNAPSHOT_MISSING_DURING_ADVANCEMENT/);
});
