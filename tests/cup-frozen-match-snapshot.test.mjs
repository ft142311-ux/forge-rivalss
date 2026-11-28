import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isCanonicalPyramidCupMatchContract,
  isValidCupParticipantMatchSnapshot,
} from '../src/app/lib/cup-participant-integrity.ts';

const resolver = readFileSync(new URL('../src/app/actions/universal-match-resolver.ts', import.meta.url), 'utf8');

function makeSnapshot(prefix) {
  return {
    id: prefix,
    players: Array.from({ length: 5 }, (_, index) => ({ id: `${prefix}-player-${index + 1}` })),
  };
}

function makeCupFixture(patch = {}) {
  return {
    id: 'cup_S1_R1_M01',
    type: 'cup',
    matchType: 'cup',
    source: 'pyramid-cup',
    cupId: 'cup_s1_lALPHA',
    cupRound: 1,
    season: 1,
    leagueId: 'ALPHA',
    homeId: 'club-home',
    awayId: 'club-away',
    homeTeamSnapshot: makeSnapshot('club-home'),
    awayTeamSnapshot: makeSnapshot('club-away'),
    bestOf: 1,
    affectsLeagueStandings: false,
    ...patch,
  };
}

test('Cup Match Core validates the canonical match contract and both frozen rosters before terminal handling', () => {
  const contractGuard = resolver.indexOf('if (isPyramidCupMatch)');
  const terminalFastPath = resolver.indexOf('if (isMatchReportFinished(match))');
  assert.ok(contractGuard >= 0 && terminalFastPath > contractGuard);
  assert.match(resolver, /options\?\.expectedCompetition === 'pyramid-cup'/);
  assert.match(resolver, /isValidCupParticipantMatchSnapshot\(match\.homeTeamSnapshot, cupHomeId\)/);
  assert.match(resolver, /isValidCupParticipantMatchSnapshot\(match\.awayTeamSnapshot, cupAwayId\)/);
  assert.match(resolver, /throw new Error\('CUP_MATCH_CONTRACT_INVALID'\)/);
});

test('canonical Pyramid Cup fixture contract pins collection identity, source, division and BO format', () => {
  assert.equal(isCanonicalPyramidCupMatchContract(makeCupFixture(), 'cup_S1_R1_M01'), true);
  assert.equal(isCanonicalPyramidCupMatchContract(
    makeCupFixture({ id: 'cup_S1_R7_M01', cupRound: 7, bestOf: 3 }),
    'cup_S1_R7_M01',
  ), true);

  const invalidPatches = [
    { matchType: 'league' },
    { source: 'league' },
    { cupId: 'cup_s2_lALPHA' },
    { leagueId: 'BETA' },
    { affectsLeagueStandings: true },
    { bestOf: 3 },
    { homeId: 'club-away' },
    { id: 'cup_S1_R1_M57' },
  ];
  for (const patch of invalidPatches) {
    assert.equal(isCanonicalPyramidCupMatchContract(makeCupFixture(patch), 'cup_S1_R1_M01'), false);
  }
  assert.equal(isCanonicalPyramidCupMatchContract(
    makeCupFixture({ id: 'cup_S1_R7_M01', cupRound: 7, bestOf: 1 }),
    'cup_S1_R7_M01',
  ), false);
  assert.equal(isCanonicalPyramidCupMatchContract(
    makeCupFixture({ id: 'cup_S1_R1_M57' }),
    'cup_S1_R1_M57',
  ), false);
  assert.equal(isCanonicalPyramidCupMatchContract(makeCupFixture({ matchType: undefined }), 'cup_S1_R1_M01'), false);
  assert.equal(isCanonicalPyramidCupMatchContract(makeCupFixture({ source: undefined }), 'cup_S1_R1_M01'), false);
});

test('Cup frozen roster validation requires five unique player identities', () => {
  const valid = makeSnapshot('club-home');
  assert.equal(isValidCupParticipantMatchSnapshot(valid, 'club-home'), true);
  assert.equal(isValidCupParticipantMatchSnapshot({
    ...valid,
    players: valid.players.map((player, index) => index === 4 ? { id: valid.players[0].id } : player),
  }, 'club-home'), false);
  assert.equal(isValidCupParticipantMatchSnapshot({
    ...valid,
    players: valid.players.map((player, index) => index === 4 ? {} : player),
  }, 'club-home'), false);
});

test('Cup Match Core always simulates from frozen snapshots in dedicated and legacy collections', () => {
  assert.match(resolver, /const frozenCupHome = isPyramidCupMatch \? match\.homeTeamSnapshot : null/);
  assert.match(resolver, /const frozenCupAway = isPyramidCupMatch \? match\.awayTeamSnapshot : null/);
  assert.match(resolver, /const homeTeamSnapshot = frozenCupHome \|\| buildMatchTeamSnapshot\(homeData/);
  assert.match(resolver, /const awayTeamSnapshot = frozenCupAway \|\| buildMatchTeamSnapshot\(awayData/);
  assert.match(resolver, /teamA: homeTeamSnapshot/);
  assert.match(resolver, /teamB: awayTeamSnapshot/);
});
