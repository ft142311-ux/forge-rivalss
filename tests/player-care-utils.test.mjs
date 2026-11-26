import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlayerCareToOwnedPlayers,
  isSamePlayerCareOperation,
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

test('player-care receipt accepts an exact retry', () => {
  const receipt = { currency: 'credits', amount: -5000, operationType: 'PLAYER_CARE_ENERGY', targetId: 'player-a' };
  assert.equal(isSamePlayerCareOperation(receipt, {
    currency: 'credits', amount: -5000, operationType: 'PLAYER_CARE_ENERGY', targetId: 'player-a',
  }), true);
});

test('player-care receipt rejects a reused key for another player or operation', () => {
  const receipt = { currency: 'credits', amount: -5000, operationType: 'PLAYER_CARE_ENERGY', targetId: 'player-a' };
  assert.equal(isSamePlayerCareOperation(receipt, {
    currency: 'credits', amount: -5000, operationType: 'PLAYER_CARE_ENERGY', targetId: 'player-b',
  }), false);
  assert.equal(isSamePlayerCareOperation(receipt, {
    currency: 'credits', amount: -5000, operationType: 'PLAYER_CARE_FORM', targetId: 'player-a',
  }), false);
  assert.equal(isSamePlayerCareOperation(receipt, {
    currency: 'crystals', amount: -5000, operationType: 'PLAYER_CARE_ENERGY', targetId: 'player-a',
  }), false);
});

test('legacy player-care receipts retain safe currency and amount matching', () => {
  const legacyReceipt = { currency: 'credits', amount: -5000 };
  assert.equal(isSamePlayerCareOperation(legacyReceipt, {
    currency: 'credits', amount: -5000, operationType: 'PLAYER_CARE_ENERGY', targetId: 'player-a',
  }), true);
  assert.equal(isSamePlayerCareOperation(legacyReceipt, {
    currency: 'credits', amount: -10000, operationType: 'PLAYER_CARE_FORM', targetId: 'player-a',
  }), false);
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
