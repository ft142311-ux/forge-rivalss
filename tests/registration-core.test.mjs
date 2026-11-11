import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
  generateStartingSquad,
} from '../src/lib/registration/registration-core.js';

function createRoundRobin(botRank = 3, botId = 'bot-3') {
  const ids = Array.from({ length: 8 }, (_, index) =>
    index + 1 === botRank ? botId : `team-${index + 1}`
  );
  const matches = [];
  for (let home = 1; home <= 8; home += 1) {
    for (let away = 1; away <= 8; away += 1) {
      if (home === away) continue;
      matches.push({
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

test('registration rejects inconsistent participant identity for a rank', () => {
  const matches = createRoundRobin();
  matches[0] = { ...matches[0], homeId: 'forged-team' };
  assert.equal(validateRegistrationSchedule(matches, 3, 'bot-3'), false);
});

test('registration rejects a bot that does not occupy the selected rank', () => {
  assert.equal(validateRegistrationSchedule(createRoundRobin(), 2, 'bot-3'), false);
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
