import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlayerCareToOwnedPlayers,
  recoverAssignedSquadPlayers,
} from '../src/app/lib/player-care-utils.ts';

test('energy recovery adds 25 and caps at 100 without changing other players', () => {
  const players = [{ id: 'a', fatigue: 80 }, { id: 'b', fatigue: 40 }];
  const result = applyPlayerCareToOwnedPlayers(players, 'a', 'energy', 0);
  assert.equal(result.value, 100);
  assert.equal(result.field, 'fatigue');
  assert.equal(result.updatedPlayers[0].fatigue, 100);
  assert.equal(result.updatedPlayers[1], players[1]);
});

test('form boost respects manager medical cap', () => {
  const result = applyPlayerCareToOwnedPlayers([{ id: 'a', form: 110 }], 'a', 'form', 20);
  assert.equal(result.value, 120);
  assert.equal(result.updatedPlayers[0].form, 120);
});

test('form boost never exceeds medical cap', () => {
  const result = applyPlayerCareToOwnedPlayers([{ id: 'a', form: 118 }], 'a', 'form', 20);
  assert.equal(result.value, 120);
});

test('player care rejects unowned and already capped players', () => {
  assert.throws(() => applyPlayerCareToOwnedPlayers([], 'missing', 'energy', 0), /PLAYER_NOT_OWNED/);
  assert.throws(() => applyPlayerCareToOwnedPlayers([{ id: 'a', fatigue: 100 }], 'a', 'energy', 0), /PLAYER_ALREADY_FULLY_RECOVERED/);
  assert.throws(() => applyPlayerCareToOwnedPlayers([{ id: 'a', form: 110 }], 'a', 'form', 10), /PLAYER_ALREADY_AT_FORM_CAP/);
});

test('squad recovery restores only assigned players and counts actual recoveries', () => {
  const players = [{ id: 'a', fatigue: 20 }, { id: 'b', fatigue: 100 }, { id: 'c', fatigue: 30 }];
  const result = recoverAssignedSquadPlayers(players, { carry: 'a', mid: 'b', reserve: 'c', support: null });
  assert.equal(result.recoveredPlayers, 2);
  assert.deepEqual(result.updatedPlayers.map((player) => player.fatigue), [100, 100, 100]);
});

test('squad recovery rejects empty or already recovered lineups', () => {
  assert.throws(() => recoverAssignedSquadPlayers([{ id: 'a', fatigue: 20 }], {}), /NO_ASSIGNED_SQUAD_PLAYERS/);
  assert.throws(() => recoverAssignedSquadPlayers([{ id: 'a', fatigue: 100 }], { carry: 'a' }), /SQUAD_ALREADY_FULLY_RECOVERED/);
});
