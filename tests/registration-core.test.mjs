import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
  generateStartingSquad,
  transferBotStandingToUser,
  buildRegistrationMatchPlan,
} from '../functions/registration-core.js';

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
    status: 'FREE', season: 4, division: 4,
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
  const completed = matches.find(match => match.homeRank === 3 && match.awayRank === 1);
  completed.status = 'finished';
  completed.isFinished = true;
  completed.startTime = '2020-01-01T00:00:00.000Z';

  const result = buildRegistrationMatchPlan(
    matches, 'bot-3', 'user-b', 'New Club', Date.parse('2026-11-14T12:00:00.000Z')
  );
  assert.equal(result.ok, true);
  assert.equal(result.updates.length, 13);
  assert.equal(result.updates.some(update => update.matchId === completed.id), false);
  assert.ok(result.updates.every(update =>
    update.patch.homeId === 'user-b' || update.patch.awayId === 'user-b'
  ));
});

test('registration is deferred while a future fixture is already processing', () => {
  const matches = createRoundRobin();
  matches[0].isProcessing = true;
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_MATCH_IN_PROGRESS');
});

test('registration is deferred when an unfinished fixture is already due', () => {
  const matches = createRoundRobin();
  matches[0].startTime = '2020-01-01T00:00:00.000Z';
  const result = buildRegistrationMatchPlan(matches, 'bot-3', 'user-b', 'New Club', Date.now());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SLOT_MATCH_DUE');
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
