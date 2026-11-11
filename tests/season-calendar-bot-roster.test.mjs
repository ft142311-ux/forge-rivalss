import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBotClub } from '../src/app/actions/bot-roster.ts';

const EXPECTED_PRO_STATS = [
  'lastHitting', 'mapAwareness', 'positioning', 'reflexes', 'manaManagement',
  'objectiveControl', 'communication', 'tiltResistance', 'versatility', 'ganking',
];

test('new bot roster contains all ten numeric proStats fields and OVR 23-27', () => {
  const club = buildBotClub('BOT_ALPHA_L2_G3_R4', 'Bot test club');

  assert.equal(club.ownedPlayers.length, 5);
  for (const player of club.ownedPlayers) {
    assert.ok(player.overallRating >= 23 && player.overallRating <= 27);
    assert.deepEqual(Object.keys(player.proStats).sort(), [...EXPECTED_PRO_STATS].sort());
    for (const field of EXPECTED_PRO_STATS) {
      assert.equal(typeof player.proStats[field], 'number');
      assert.equal(player.proStats[field], player.overallRating);
    }
  }
});
