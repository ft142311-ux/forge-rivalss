import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTournamentStageMatchKey,
  isTournamentStageMatchComplete,
  isTournamentStageMatchSetComplete,
} from '../src/app/lib/tournament-stage-utils.ts';

test('completed group draws count as completed while knockout draws do not', () => {
  const draw = { status: 'finished', homeId: 'a', awayId: 'b', winnerId: null };
  assert.equal(isTournamentStageMatchComplete(draw, 'groups'), true);
  assert.equal(isTournamentStageMatchComplete(draw, 'quarterfinal'), false);
  assert.equal(isTournamentStageMatchComplete({ ...draw, winnerId: 'a' }, 'quarterfinal'), true);
});

test('tournament stage completion rejects invalid participants and foreign winners', () => {
  assert.equal(isTournamentStageMatchComplete({ status: 'processing', homeId: 'a', awayId: 'b' }, 'groups'), false);
  assert.equal(isTournamentStageMatchComplete({ status: 'finished', homeId: 'a', awayId: 'a' }, 'groups'), false);
  assert.equal(isTournamentStageMatchComplete({ status: 'finished', homeId: 'a', awayId: 'b', winnerId: 'c' }, 'groups'), false);
});

test('group fixture identity includes group and round so repeated pair indices remain unique', () => {
  const a = { groupId: 'A', round: 1, index: 1 };
  const b = { groupId: 'B', round: 1, index: 1 };
  const c = { groupId: 'A', round: 2, index: 1 };
  assert.notEqual(getTournamentStageMatchKey(a, 'groups', 'doc-a'), getTournamentStageMatchKey(b, 'groups', 'doc-b'));
  assert.notEqual(getTournamentStageMatchKey(a, 'groups', 'doc-a'), getTournamentStageMatchKey(c, 'groups', 'doc-c'));
  assert.equal(getTournamentStageMatchKey(a, 'groups', 'doc-a'), getTournamentStageMatchKey(a, 'groups', 'doc-other'));
  assert.equal(getTournamentStageMatchKey({ round: 1, index: 1 }, 'groups', 'doc'), null);
});

test('knockout fixture identity remains stable by stage and index', () => {
  assert.equal(getTournamentStageMatchKey({ index: 2 }, 'semifinal', 'doc-a'), 'semifinal:2');
  assert.equal(getTournamentStageMatchKey({}, 'final', 'doc-final'), 'final:doc-final');
});


test('group stage requires the exact A-D group, round and pair-index fixture matrix', () => {
  const groupTeamsById = {};
  const pairingsByRound = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  const complete = [];
  for (const groupId of ['A', 'B', 'C', 'D']) {
    const teamIds = Array.from({ length: 4 }, (_, index) => `team_${groupId}_${index + 1}`);
    groupTeamsById[groupId] = teamIds;
    for (let round = 1; round <= 3; round++) {
      for (let index = 1; index <= 2; index++) {
        const [homeIndex, awayIndex] = pairingsByRound[round - 1][index - 1];
        complete.push({
          id: `groups_${groupId}_${round}_${index}`,
          data: {
            stage: 'groups',
            status: 'finished',
            groupId,
            round,
            index,
            homeId: teamIds[homeIndex],
            awayId: teamIds[awayIndex],
            winnerId: null,
          },
        });
      }
    }
  }
  assert.equal(isTournamentStageMatchSetComplete(complete, 'groups', 16, groupTeamsById), true);
  const malformed = complete.map(entry => ({ ...entry, data: { ...entry.data } }));
  malformed[0].data.groupId = 'Z';
  assert.equal(isTournamentStageMatchSetComplete(malformed, 'groups', 16, groupTeamsById), false);
  assert.equal(isTournamentStageMatchSetComplete(complete.slice(1), 'groups', 16, groupTeamsById), false);
});

test('knockout stage requires every expected index exactly once', () => {
  const complete = Array.from({ length: 4 }, (_, index) => ({
    id: `quarterfinal_${index + 1}`,
    data: { stage: 'quarterfinal', status: 'finished', index: index + 1, homeId: `h${index}`, awayId: `a${index}`, winnerId: `h${index}` },
  }));
  assert.equal(isTournamentStageMatchSetComplete(complete, 'quarterfinal', 32), true);
  const wrongIndex = complete.map(entry => ({ ...entry, data: { ...entry.data } }));
  wrongIndex[3].data.index = 5;
  assert.equal(isTournamentStageMatchSetComplete(wrongIndex, 'quarterfinal', 32), false);
});

test('32-team group stage requires all eight groups and all 48 fixtures', () => {
  const entries = [];
  const groupTeamsById = {};
  const pairingsByRound = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  for (const groupId of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const teamIds = Array.from({ length: 4 }, (_, index) => `team_${groupId}_${index + 1}`);
    groupTeamsById[groupId] = teamIds;
    for (let round = 1; round <= 3; round++) {
      for (let index = 1; index <= 2; index++) {
        const [homeIndex, awayIndex] = pairingsByRound[round - 1][index - 1];
        entries.push({
          id: `groups_${groupId}_${round}_${index}`,
          data: {
            status: 'finished',
            groupId,
            round,
            index,
            homeId: teamIds[homeIndex],
            awayId: teamIds[awayIndex],
            winnerId: null,
          },
        });
      }
    }
  }

  assert.equal(entries.length, 48);
  assert.equal(isTournamentStageMatchSetComplete(entries, 'groups', 32, groupTeamsById), true);

  const missingHFixture = entries.filter(entry => entry.id !== 'groups_H_3_2');
  assert.equal(isTournamentStageMatchSetComplete(missingHFixture, 'groups', 32, groupTeamsById), false);

  const duplicatePair = entries.map(entry => ({ ...entry, data: { ...entry.data } }));
  duplicatePair[47].data.index = 1;
  assert.equal(isTournamentStageMatchSetComplete(duplicatePair, 'groups', 32, groupTeamsById), false);
});

test('16-team tournaments skip round of 16 while 32-team tournaments require it', () => {
  const roundOf16 = Array.from({ length: 8 }, (_, index) => ({
    id: `round_of_16_${index + 1}`,
    data: {
      status: 'finished',
      index: index + 1,
      homeId: `home_${index}`,
      awayId: `away_${index}`,
      winnerId: `home_${index}`,
    },
  }));

  assert.equal(isTournamentStageMatchSetComplete(roundOf16, 'round_of_16', 16), false);
  assert.equal(isTournamentStageMatchSetComplete(roundOf16, 'round_of_16', 32), true);
});

