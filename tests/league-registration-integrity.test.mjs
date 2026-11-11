import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isEligibleRegistrationSlot, validateRegistrationSchedule } = require('../functions/league-integrity.js');
function fixtures(byRank) {
  const matches = [];
  for (let homeRank = 1; homeRank <= 8; homeRank++) for (let awayRank = 1; awayRank <= 8; awayRank++) {
    if (homeRank !== awayRank) matches.push({ homeId: byRank[homeRank], homeRank, awayId: byRank[awayRank], awayRank });
  }
  return matches;
}
test('registration refuses observed D1-G1 table rank 4 vs fixture rank 5 conflict', () => {
  const human = 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba';
  const byRank = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, `BOT_ALPHA_L1_G1_R${i + 1}`]));
  byRank[5] = human;
  const matches = fixtures(byRank);
  assert.equal(validateRegistrationSchedule(matches, 4, 'BOT_ALPHA_L1_G1_R4'), true);
  assert.equal(validateRegistrationSchedule(matches, 5, 'BOT_ALPHA_L1_G1_R5'), false);
});
test('registration refuses duplicate rank identities and incomplete round robins', () => {
  const byRank = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, `BOT_ALPHA_L1_G1_R${i + 1}`]));
  const matches = fixtures(byRank);
  const conflicting = structuredClone(matches);
  conflicting[0].homeId = 'OTHER_TEAM';
  assert.equal(validateRegistrationSchedule(conflicting, 1, byRank[1]), false);
  assert.equal(validateRegistrationSchedule(matches.slice(1), 1, byRank[1]), false);
});


test('new registration can randomly claim any free D1-D4 slot in the active season', () => {
  const base = { season: 7, status: 'FREE', occupantId: null };
  for (const division of [1, 2, 3, 4]) {
    assert.equal(isEligibleRegistrationSlot({ ...base, division }, 7), true);
  }
  assert.equal(isEligibleRegistrationSlot({ ...base, division: 0 }, 7), false);
  assert.equal(isEligibleRegistrationSlot({ ...base, division: 5 }, 7), false);
  assert.equal(isEligibleRegistrationSlot({ ...base, division: 4 }, 8), false);
  assert.equal(isEligibleRegistrationSlot({ ...base, division: 4, status: 'OCCUPIED', occupantId: 'user-1' }, 7), false);
  assert.equal(isEligibleRegistrationSlot({ ...base, division: 4, occupantId: 'user-1' }, 7), false);
});
