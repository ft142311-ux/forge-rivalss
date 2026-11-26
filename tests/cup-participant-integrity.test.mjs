import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCanonicalCupParticipantField, isCanonicalPyramidCupOpeningField, isPyramidCupRoundProgressionValid } from '../src/app/lib/cup-participant-integrity.ts';

function createParticipants() {
  const participants = [];
  for (let level = 1; level <= 4; level += 1) {
    for (let group = 1; group <= Math.pow(2, level - 1); group += 1) {
      for (let rank = 1; rank <= 8; rank += 1) {
        participants.push({ id: 'cup-d' + level + '-g' + group + '-r' + rank, level, group, rank, seed: participants.length + 1 });
      }
    }
  }
  return participants;
}

function createBracket() {
  const participants = createParticipants();
  const restTeams = participants.filter(team => team.level === 1);
  let teams = participants.filter(team => team.level !== 1);
  const rounds = {};
  for (let round = 1; round <= 7; round += 1) {
    const pairings = [];
    for (let index = 0; index < teams.length; index += 2) {
      const home = teams[index];
      const away = teams[index + 1];
      pairings.push({ id: 'r' + round + '_m' + (pairings.length + 1), index: pairings.length + 1, home, away, status: round === 7 ? 'scheduled' : 'finished', winnerId: round === 7 ? null : home.id });
    }
    rounds['r' + round] = pairings;
    teams = round === 1 ? [...restTeams, ...pairings.map(pairing => pairing.home)] : pairings.map(pairing => pairing.home);
  }
  return { participants, restTeams, rounds };
}

test('canonical Cup field contains all 120 league slots exactly once', () => {
  assert.equal(isCanonicalCupParticipantField(createParticipants()), true);
});

test('Cup field rejects duplicate slot coordinates, duplicate IDs and invalid ranks', () => {
  const duplicateSlot = createParticipants();
  duplicateSlot[1] = { ...duplicateSlot[1], rank: 1 };
  assert.equal(isCanonicalCupParticipantField(duplicateSlot), false);
  const duplicateId = createParticipants();
  duplicateId[1] = { ...duplicateId[1], id: duplicateId[0].id };
  assert.equal(isCanonicalCupParticipantField(duplicateId), false);
  const invalidRank = createParticipants();
  invalidRank[0] = { ...invalidRank[0], rank: 9 };
  assert.equal(isCanonicalCupParticipantField(invalidRank), false);
});

test('opening field excludes D1 and includes every D2-D4 participant exactly once', () => {
  const bracket = createBracket();
  assert.equal(isCanonicalPyramidCupOpeningField(bracket.participants, bracket.rounds.r1, bracket.restTeams), true);
  const d1InOpening = bracket.rounds.r1.map((pairing, index) => index === 0 ? { ...pairing, home: bracket.restTeams[0] } : pairing);
  assert.equal(isCanonicalPyramidCupOpeningField(bracket.participants, d1InOpening, bracket.restTeams), false);
  assert.equal(isCanonicalPyramidCupOpeningField(bracket.participants, bracket.rounds.r1.slice(1), bracket.restTeams), false);
});

test('round progression adds D1 in round two and carries only previous winners forward', () => {
  const bracket = createBracket();
  assert.equal(isPyramidCupRoundProgressionValid(bracket.rounds, 7, bracket.restTeams), true);
  const wrongRoundTwo = { ...bracket.rounds, r2: bracket.rounds.r2.map((pairing, index) => index === 0 ? { ...pairing, home: bracket.rounds.r1[0].away } : pairing) };
  assert.equal(isPyramidCupRoundProgressionValid(wrongRoundTwo, 7, bracket.restTeams), false);
  const wrongRoundThree = { ...bracket.rounds, r3: bracket.rounds.r3.map((pairing, index) => index === 0 ? { ...pairing, home: bracket.rounds.r2[0].away } : pairing) };
  assert.equal(isPyramidCupRoundProgressionValid(wrongRoundThree, 7, bracket.restTeams), false);
  const invalidWinner = { ...bracket.rounds, r1: bracket.rounds.r1.map((pairing, index) => index === 0 ? { ...pairing, winnerId: 'not-a-participant' } : pairing) };
  assert.equal(isPyramidCupRoundProgressionValid(invalidWinner, 7, bracket.restTeams), false);
});

test('season publication and active Cup diagnostics enforce shared validators and frozen snapshots', () => {
  const calendar = readFileSync(new URL('../src/app/actions/season-calendar.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/admin/staging-cup-diagnostics/route.ts', import.meta.url), 'utf8');
  assert.match(calendar, /isCanonicalPyramidCupOpeningField\(participants, firstRound, restTeams\)/);
  assert.match(route, /isCanonicalPyramidCupOpeningField\(participants, rounds\.r1, restTeams\)/);
  assert.match(route, /isPyramidCupRoundProgressionValid\(rounds, currentRound, restTeams\)/);
  assert.match(route, /fixture\.homeTeamSnapshot\?\.id/);
  assert.match(route, /fixture\.awayTeamSnapshot\?\.id/);
  assert.match(route, /JSON\.stringify\(fixture\.homeTeamSnapshot\)/);
});
