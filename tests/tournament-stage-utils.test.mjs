import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTournamentStageMatchKey,
  isTournamentStageMatchComplete,
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
