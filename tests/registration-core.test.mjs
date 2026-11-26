import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ARENA_CAPACITY,
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
  generateStartingSquad,
  transferBotStandingToUser,
  buildRegistrationMatchPlan,
  isPyramidCupReadyForRegistration,
} from '../functions/registration-core.js';

test('registration accepts only the canonical active-season Pyramid Cup opening field', () => {
  const cup = createRegistrationCup(3);
  assert.equal(isPyramidCupReadyForRegistration(cup, 3), true);
  assert.equal(isPyramidCupReadyForRegistration(cup, 4), false);
  assert.equal(isPyramidCupReadyForRegistration(null, 3), false);
  assert.equal(isPyramidCupReadyForRegistration({ ...cup, season: 2 }, 3), false);
  assert.equal(isPyramidCupReadyForRegistration({ ...cup, formatVersion: 3 }, 3), false);
});

test('registration rejects duplicate, BYE, D1-opening and incomplete-rest Cup fields', () => {
  const cup = createRegistrationCup(3);
  const duplicateParticipant = {
    ...cup,
    participants: cup.participants.map((team, index) =>
      index === 1 ? { ...team, id: cup.participants[0].id } : team
    ),
  };
  assert.equal(isPyramidCupReadyForRegistration(duplicateParticipant, 3), false);

  const openingBye = {
    ...cup,
    rounds: {
      ...cup.rounds,
      r1: cup.rounds.r1.map((pairing, index) =>
        index === 0 ? { ...pairing, away: null } : pairing
      ),
    },
  };
  assert.equal(isPyramidCupReadyForRegistration(openingBye, 3), false);

  const d1InOpening = {
    ...cup,
    rounds: {
      ...cup.rounds,
      r1: cup.rounds.r1.map((pairing, index) =>
        index === 0 ? { ...pairing, home: cup.openingRoundRestTeams[0] } : pairing
      ),
    },
  };
  assert.equal(isPyramidCupReadyForRegistration(d1InOpening, 3), false);

  const wrongRestTeams = { ...cup, openingRoundRestTeams: cup.openingRoundRestTeams.slice(1) };
  assert.equal(isPyramidCupReadyForRegistration(wrongRestTeams, 3), false);
});

test('registration rejects duplicate league slot coordinates even when IDs and seeds are unique', () => {
  const cup = createRegistrationCup(3);
  const duplicateSlot = { ...cup, participants: cup.participants.map((team, index) => index === 1 ? { ...team, rank: 1 } : team) };
  assert.equal(isPyramidCupReadyForRegistration(duplicateSlot, 3), false);
});

test('registration accepts a completed Pyramid Cup only with a recorded champion', () => {
  const cup = createRegistrationCup(3);
  const completed = {
    ...cup,
    status: 'completed',
    currentRound: 7,
    winnerId: cup.participants[0].id,
  };
  assert.equal(isPyramidCupReadyForRegistration(completed, 3), true);
  assert.equal(isPyramidCupReadyForRegistration({ ...completed, winnerId: null }, 3), false);
  assert.equal(isPyramidCupReadyForRegistration({ ...completed, winnerId: 'OUTSIDE_CUP' }, 3), false);
  assert.equal(isPyramidCupReadyForRegistration({ ...completed, status: 'COMPLETED' }, 3), true);
});

test('new clubs start with the canonical 3,000-seat arena capacity', () => {
  assert.equal(DEFAULT_ARENA_CAPACITY, 3000);
});

function createRegistrationCup(season = 3) {
  const participants = [];
  for (let level = 1; level <= 4; level += 1) {
    for (let group = 1; group <= Math.pow(2, level - 1); group += 1) {
      for (let rank = 1; rank <= 8; rank += 1) {
        const seed = participants.length + 1;
        participants.push({
          id: 'cup-team-d' + level + '-g' + group + '-r' + rank,
          name: 'D' + level + ' G' + group + ' R' + rank,
          level,
          group,
          rank,
          seed,
        });
      }
    }
  }
  const eligible = participants.filter(team => team.level !== 1);
  const openingRound = Array.from({ length: 56 }, (_, index) => {
    const stronger = eligible[eligible.length - 2 - index * 2];
    const weaker = eligible[eligible.length - 1 - index * 2];
    const pairingIndex = index + 1;
    return {
      id: 'r1_m' + pairingIndex,
      index: pairingIndex,
      matchId: 'cup_S' + season + '_R1_M' + String(pairingIndex).padStart(2, '0'),
      status: 'scheduled',
      home: weaker,
      away: stronger,
    };
  });
  return {
    id: 'cup_s' + season + '_lALPHA',
    season,
    leagueId: 'ALPHA',
    name: 'Кубок Пирамиды',
    status: 'active',
    currentRound: 1,
    formatVersion: 4,
    format: 'D1_REST_OPENING_ROUND',
    totalRounds: 7,
    totalParticipants: 120,
    totalMatches: 119,
    preliminaryMatches: 56,
    openingRoundRestCount: 8,
    openingRoundRestTeams: participants.filter(team => team.level === 1),
    byeCount: 0,
    participants,
    rounds: { r1: openingRound, r2: [], r3: [], r4: [], r5: [], r6: [], r7: [] },
  };
}

function createRoundRobin(botRank = 3, botId = 'bot-3') {
  const ids = Array.from({ length: 8 }, (_, index) =>
    index + 1 === botRank ? botId : `team-${index + 1}`
  );
  const matches = [];
  for (let home = 1; home <= 8; home += 1) {
    for (let away = 1; away <= 8; away += 1) {
      if (home === away) continue;
      matches.push({
        id: `match-${home}-${away}`,
        homeId: ids[home - 1],
        awayId: ids[away - 1],
        homeRank: home,
        awayRank: away,
      });
    }
  }
  return matches;
}

test('registration accepts only a free slot in the active season and supported divisions', () => {
  assert.equal(isEligibleRegistrationSlot({
    status: 'FREE', season: 4, division: 4, group: 8, rank: 8,
  }, 4), true);
  assert.equal(isEligibleRegistrationSlot({
    status: 'OCCUPIED', season: 4, division: 4,
  }, 4), false);
  assert.equal(isEligibleRegistrationSlot({
    status: 'FREE', occupantId: 'user-1', season: 4, division: 4,
  }, 4), false);
  assert.equal(isEligibleRegistrationSlot({
    status: 'FREE', season: 3, division: 4,
  }, 4), false);
  assert.equal(isEligibleRegistrationSlot({
    status: 'FREE', season: 4, division: 5,
  }, 4), false);
});

test('registration accepts a complete 8-team double round-robin schedule', () => {
  assert.equal(validateRegistrationSchedule(createRoundRobin(), 3, 'bot-3'), true);
});

test('registration rejects a schedule with a missing fixture', () => {
  const matches = createRoundRobin();
  matches.pop();
  assert.equal(validateRegistrationSchedule(matches, 3, 'bot-3'), false);
});

test('registration rejects duplicate directional fixtures', () => {
  const matches = createRoundRobin();
  matches[1] = { ...matches[0] };
  assert.equal(validateRegistrationSchedule(matches, 3, 'bot-3'), false);
});

test('registration rejects inconsistent participant identity in unfinished fixtures', () => {
  const matches = createRoundRobin();
  matches[0] = { ...matches[0], homeId: 'forged-team' };
  assert.equal(validateRegistrationSchedule(matches, 3, 'bot-3'), false);
});

test('registration accepts historical owners in completed fixtures while bot owns future fixtures', () => {
  const matches = createRoundRobin();
  const completed = matches.find(match => match.homeRank === 3 && match.awayRank === 1);
  completed.homeId = 'previous-user';
  completed.status = 'finished';
  completed.isFinished = true;

  assert.equal(validateRegistrationSchedule(matches, 3, 'bot-3'), true);
});

test('registration rejects a bot that does not occupy the selected rank', () => {
  assert.equal(validateRegistrationSchedule(createRoundRobin(), 2, 'bot-3'), false);
});

test('transferring a bot standings row preserves every accumulated season statistic', () => {
  const stats = {
    'bot-3': {
      id: 'bot-3', name: 'Bot', rank: 3, isBot: true,
      matchesPlayed: 5, wins: 3, draws: 1, losses: 1, points: 10, diff: 7,
      customSeasonField: 'preserve-me',
    },
    'team-1': { id: 'team-1', rank: 1, isBot: false, points: 15 },
  };

  const result = transferBotStandingToUser(stats, 'bot-3', 'user-b', 'New Club', 3);
  assert.equal(result.ok, true);
  assert.equal(result.stats['bot-3'], undefined);
  assert.deepEqual(result.stats['user-b'], {
    ...stats['bot-3'], id: 'user-b', name: 'New Club', rank: 3, isBot: false,
  });
  assert.equal(result.stats['user-b'].points, 10);
  assert.equal(result.stats['user-b'].matchesPlayed, 5);
  assert.equal(result.stats['user-b'].customSeasonField, 'preserve-me');
});

test('registration match plan leaves completed fixtures unchanged and rewrites only future fixtures', () => {
  const matches = createRoundRobin();
  for (const match of matches) match.startTime = '2026-11-15T12:00:00.000Z';
  const completed = matches.find(match => match.homeRank === 3 && match.awayRank === 1);
  completed.status = 'finished';
  completed.isFinished = true;
  completed.startTime = '2020-01-01T00:00:00.000Z';
  completed.homeLogo = 'historical-bot-logo';

  const future = matches.find(match => match.homeRank === 3 && match.awayRank === 2);
  future.homeLogo = 'old-bot-logo';

  const result = buildRegistrationMatchPlan(
    matches, 'bot-3', 'user-b', 'New Club', Date.parse('2026-11-14T12:00:00.000Z')
  );
  assert.equal(result.ok, true);
  assert.equal(result.updates.length, 13);
  assert.equal(result.updates.some(update => update.matchId === completed.id), false);
  assert.ok(result.updates.every(update =>
    update.patch.homeId === 'user-b' || update.patch.awayId === 'user-b'
  ));
  assert.equal(result.updates.find(update => update.matchId === future.id).patch.homeLogo, null);
});

test('registration is deferred while a future fixture for this slot is already processing', () => {
  const matches = createRoundRobin();
  for (const match of matches) match.startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const target = matches.find(match => match.homeId === 'bot-3' || match.awayId === 'bot-3');
  target.isProcessing = true;
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_MATCH_IN_PROGRESS');
});

test('registration is deferred when a fixture has started even if processing flag is stale', () => {
  const matches = createRoundRobin();
  for (const match of matches) match.startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const target = matches.find(match => match.homeId === 'bot-3' || match.awayId === 'bot-3');
  target.startedAt = new Date(Date.now() - 60 * 1000).toISOString();
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_MATCH_IN_PROGRESS');
});

test('registration is deferred when an unfinished fixture for this slot is already due', () => {
  const matches = createRoundRobin();
  for (const match of matches) match.startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const target = matches.find(match => match.homeId === 'bot-3' || match.awayId === 'bot-3');
  target.startTime = '2020-01-01T00:00:00.000Z';
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_MATCH_DUE');
});

test('a due fixture for unrelated teams does not block this slot registration', () => {
  const matches = createRoundRobin();
  for (const match of matches) match.startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  matches[0].startTime = '2020-01-01T00:00:00.000Z';
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, true);
});

test('registration fails closed when a target fixture has no trustworthy start time', () => {
  const matches = createRoundRobin();
  for (const match of matches) match.startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const target = matches.find(match => match.homeId === 'bot-3' || match.awayId === 'bot-3');
  delete target.startTime;
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_MATCH_TIME_UNKNOWN');
});

test('starting squad contains ten players with the expected role distribution', () => {
  const squad = generateStartingSquad();
  assert.equal(squad.length, 10);
  assert.deepEqual(
    squad.map((player) => player.role),
    ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support', 'Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'],
  );
  assert.equal(new Set(squad.map((player) => player.id)).size, 10);
  assert.ok(squad.every((player) => player.overallRating >= 28 && player.overallRating <= 37));
});
