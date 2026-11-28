import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCanonicalCupParticipantField, isCanonicalPyramidCupOpeningField, isPyramidCupRoundProgressionValid, isValidCupParticipantMatchSnapshot, isCupParticipantMatchSnapshotCompatible, isValidPyramidCupWinner } from '../src/app/lib/cup-participant-integrity.ts';

function createParticipants() {
  const participants = [];
  for (let level = 1; level <= 4; level += 1) {
    for (let group = 1; group <= Math.pow(2, level - 1); group += 1) {
      for (let rank = 1; rank <= 8; rank += 1) {
        const id = 'cup-d' + level + '-g' + group + '-r' + rank;
        participants.push({ id, name: 'Team ' + id, level, group, rank, isBot: id.startsWith('BOT_'), seed: participants.length + 1 });
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
  assert.equal(isPyramidCupRoundProgressionValid(bracket.rounds, 7, bracket.restTeams, bracket.participants), true);
  const wrongRoundTwo = { ...bracket.rounds, r2: bracket.rounds.r2.map((pairing, index) => index === 0 ? { ...pairing, home: bracket.rounds.r1[0].away } : pairing) };
  assert.equal(isPyramidCupRoundProgressionValid(wrongRoundTwo, 7, bracket.restTeams, bracket.participants), false);
  const wrongRoundThree = { ...bracket.rounds, r3: bracket.rounds.r3.map((pairing, index) => index === 0 ? { ...pairing, home: bracket.rounds.r2[0].away } : pairing) };
  assert.equal(isPyramidCupRoundProgressionValid(wrongRoundThree, 7, bracket.restTeams, bracket.participants), false);
  const invalidWinner = { ...bracket.rounds, r1: bracket.rounds.r1.map((pairing, index) => index === 0 ? { ...pairing, winnerId: 'not-a-participant' } : pairing) };
  assert.equal(isPyramidCupRoundProgressionValid(invalidWinner, 7, bracket.restTeams, bracket.participants), false);
});

test('season publication and active Cup diagnostics enforce shared validators and frozen snapshots', () => {
  const calendar = readFileSync(new URL('../src/app/actions/season-calendar.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/admin/staging-cup-diagnostics/route.ts', import.meta.url), 'utf8');
  assert.match(calendar, /isCanonicalPyramidCupOpeningField\(participants, firstRound, restTeams\)/);
  assert.match(route, /isCanonicalPyramidCupOpeningField\(participants, rounds\.r1, restTeams\)/);
  assert.match(route, /isPyramidCupRoundProgressionValid\(rounds, currentRound, restTeams, participants\)/);
  assert.match(route, /isValidCupParticipantMatchSnapshot\(data\.matchSnapshot, id\)/);
  assert.match(route, /data\.cupId !== cupId/);
  assert.match(route, /data\.teamId !== id/);
  assert.match(route, /isCupParticipantMatchSnapshotCompatible\(fixture\.homeTeamSnapshot/);
  assert.match(route, /isCupParticipantMatchSnapshotCompatible\(fixture\.awayTeamSnapshot/);
  assert.doesNotMatch(route, /JSON\.stringify\(fixture\.homeTeamSnapshot\)/);
});


test('round progression rejects D1 rest entrants in the opening round and malformed rest lists', () => {
  const bracket = createBracket();
  const d1InOpening = {
    ...bracket.rounds,
    r1: bracket.rounds.r1.map((pairing, index) =>
      index === 0 ? { ...pairing, home: bracket.restTeams[0] } : pairing
    ),
  };
  assert.equal(isPyramidCupRoundProgressionValid(d1InOpening, 1, bracket.restTeams, bracket.participants), false);

  const duplicateRest = [...bracket.restTeams.slice(0, 7), bracket.restTeams[0]];
  assert.equal(isPyramidCupRoundProgressionValid(bracket.rounds, 1, duplicateRest, bracket.participants), false);

  const nonD1Rest = bracket.restTeams.map((team, index) =>
    index === 0 ? { ...team, level: 2 } : team
  );
  assert.equal(isPyramidCupRoundProgressionValid(bracket.rounds, 1, nonD1Rest, bracket.participants), false);
});


test('frozen Cup participant snapshots require five distinct non-empty player IDs', () => {
  const snapshot = {
    id: 'cup-team-1',
    players: Array.from({ length: 5 }, (_, index) => ({ id: 'player-' + (index + 1) })),
  };
  assert.equal(isValidCupParticipantMatchSnapshot(snapshot, 'cup-team-1'), true);
  assert.equal(isValidCupParticipantMatchSnapshot(snapshot, 'cup-team-2'), false);
  assert.equal(isValidCupParticipantMatchSnapshot({ ...snapshot, players: snapshot.players.slice(0, 4) }, 'cup-team-1'), false);
  assert.equal(isValidCupParticipantMatchSnapshot({ ...snapshot, players: snapshot.players.map((player, index) => index === 4 ? { id: 'player-1' } : player) }, 'cup-team-1'), false);
  assert.equal(isValidCupParticipantMatchSnapshot({ ...snapshot, players: snapshot.players.map((player, index) => index === 4 ? {} : player) }, 'cup-team-1'), false);
  assert.equal(isValidCupParticipantMatchSnapshot(null, 'cup-team-1'), false);
});

test('Cup snapshot equality ignores object key order but preserves roster order and values', () => {
  const home = {
    id: 'home-team',
    players: Array.from({ length: 5 }, (_, index) => ({
      id: 'h-' + index,
      attributes: { role: 'carry', rating: 20 },
    })),
  };
  const stored = {
    players: home.players.map(player => ({
      attributes: { rating: 20, role: 'carry' },
      id: player.id,
    })),
    id: 'home-team',
  };
  assert.equal(isCupParticipantMatchSnapshotCompatible(stored, home, 'home-team'), true);
  assert.equal(isCupParticipantMatchSnapshotCompatible(
    { ...stored, players: [...stored.players].reverse() },
    home,
    'home-team',
  ), false);
  assert.equal(isCupParticipantMatchSnapshotCompatible(
    { ...stored, players: stored.players.map((player, index) => index === 0 ? { ...player, attributes: { ...player.attributes, rating: 21 } } : player) },
    home,
    'home-team',
  ), false);
  assert.equal(isCupParticipantMatchSnapshotCompatible({ ...stored, id: 'away-team' }, home, 'home-team'), false);
});


test('Cup participant field requires complete identities and unique seeds from 1 through 120', () => {
  const duplicateSeed = createParticipants();
  duplicateSeed[1] = { ...duplicateSeed[1], seed: duplicateSeed[0].seed };
  assert.equal(isCanonicalCupParticipantField(duplicateSeed), false);
  const invalidSeed = createParticipants();
  invalidSeed[0] = { ...invalidSeed[0], seed: 121 };
  assert.equal(isCanonicalCupParticipantField(invalidSeed), false);
  const missingName = createParticipants();
  missingName[0] = { ...missingName[0], name: '  ' };
  assert.equal(isCanonicalCupParticipantField(missingName), false);
  const malformedBotFlag = createParticipants();
  malformedBotFlag[0] = { ...malformedBotFlag[0], isBot: 'true' };
  assert.equal(isCanonicalCupParticipantField(malformedBotFlag), false);
});

test('every round preserves canonical participant name, division, group, rank, seed and bot identity', () => {
  const bracket = createBracket();
  const alteredSeed = { ...bracket.rounds, r3: bracket.rounds.r3.map((pairing, index) =>
    index === 0 ? { ...pairing, home: { ...pairing.home, seed: pairing.home.seed + 1 } } : pairing
  ) };
  assert.equal(isPyramidCupRoundProgressionValid(alteredSeed, 7, bracket.restTeams, bracket.participants), false);
  const alteredDivision = { ...bracket.rounds, r4: bracket.rounds.r4.map((pairing, index) =>
    index === 0 ? { ...pairing, away: { ...pairing.away, level: 99 } } : pairing
  ) };
  assert.equal(isPyramidCupRoundProgressionValid(alteredDivision, 7, bracket.restTeams, bracket.participants), false);
  const alteredName = { ...bracket.rounds, r2: bracket.rounds.r2.map((pairing, index) =>
    index === 0 ? { ...pairing, home: { ...pairing.home, name: 'Changed club' } } : pairing
  ) };
  assert.equal(isPyramidCupRoundProgressionValid(alteredName, 7, bracket.restTeams, bracket.participants), false);
});

test('Pyramid Cup accepts only a winner who is one of the match participants', () => {
  assert.equal(isValidPyramidCupWinner({ winnerId: 'home' }, 'home', 'away'), true);
  assert.equal(isValidPyramidCupWinner({ winnerId: 'away' }, 'home', 'away'), true);
  assert.equal(isValidPyramidCupWinner({ winnerId: 'foreign' }, 'home', 'away'), false);
  assert.equal(isValidPyramidCupWinner({ winnerId: ' ' }, 'home', 'away'), false);
  assert.equal(isValidPyramidCupWinner({ winnerId: 'home' }, 'home', 'home'), false);
});
