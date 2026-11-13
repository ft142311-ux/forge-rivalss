import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildBotClub, botIdFor, isFinished } = require('../functions/club-inactivity-sweep.js');

test('uses the canonical bot identity derived from league coordinates', () => {
  assert.equal(botIdFor({ division: 2, group: 1, rank: 7 }), 'BOT_ALPHA_L2_G1_R7');
});

test('replacement bot has a deterministic five-player roster with valid pro stats', () => {
  const first = buildBotClub('BOT_ALPHA_L2_G1_R7', 'Bot0100107');
  const second = buildBotClub('BOT_ALPHA_L2_G1_R7', 'Bot0100107');
  assert.deepEqual(first, second);
  assert.equal(first.ownedPlayers.length, 5);
  assert.equal(first.isBot, true);
  for (const player of first.ownedPlayers) {
    assert.ok(player.overallRating >= 23 && player.overallRating <= 27);
    assert.equal(player.isBot, true);
    assert.equal(typeof player.proStats.lastHitting, 'number');
    assert.equal(typeof player.proStats.manaManagement, 'number');
  }
});

test('completed fixtures are identified and never eligible for participant rewrites', () => {
  assert.equal(isFinished({ isFinished: true, status: 'scheduled' }), true);
  assert.equal(isFinished({ status: 'FINISHED' }), true);
  assert.equal(isFinished({ isFinished: false, status: 'scheduled' }), false);
});
