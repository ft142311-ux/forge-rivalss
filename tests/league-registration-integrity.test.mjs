import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isEligibleRegistrationSlot, validateRegistrationSchedule } = require('../functions/league-integrity.js');
const { transferBotStandingToUser } = require('../functions/registration-core.js');
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


test('bot standings transfer preserves results and rejects a second transfer', () => {
  const original = {
    BOT_ALPHA_L2_G1_R3: {
      id: 'BOT_ALPHA_L2_G1_R3', name: 'League Bot', rank: 3, isBot: true,
      matchesPlayed: 14, wins: 9, draws: 2, losses: 3, points: 29, diff: 17,
    },
  };
  const first = transferBotStandingToUser(original, 'BOT_ALPHA_L2_G1_R3', 'user-123', 'New Club', 3);
  assert.equal(first.ok, true);
  assert.equal(first.stats['BOT_ALPHA_L2_G1_R3'], undefined);
  assert.deepEqual(first.stats['user-123'], {
    ...original.BOT_ALPHA_L2_G1_R3,
    id: 'user-123', name: 'New Club', rank: 3, isBot: false,
  });
  assert.deepEqual(original.BOT_ALPHA_L2_G1_R3, {
    id: 'BOT_ALPHA_L2_G1_R3', name: 'League Bot', rank: 3, isBot: true,
    matchesPlayed: 14, wins: 9, draws: 2, losses: 3, points: 29, diff: 17,
  }, 'the source standings object remains immutable');

  const second = transferBotStandingToUser(first.stats, 'BOT_ALPHA_L2_G1_R3', 'user-456', 'Second Club', 3);
  assert.deepEqual(second, { ok: false, reason: 'LEAGUE_TABLE_SLOT_CONFLICT' });
  const duplicateUser = transferBotStandingToUser(first.stats, 'BOT_ALPHA_L2_G1_R3', 'user-123', 'New Club', 3);
  assert.deepEqual(duplicateUser, { ok: false, reason: 'LEAGUE_TABLE_SLOT_CONFLICT' });
});


test('canonical league pyramid contains exactly 120 unique slots across 15 groups', () => {
  const season = 9;
  const groupsByDivision = new Map([[1, 1], [2, 2], [3, 4], [4, 8]]);
  const slots = [];

  for (const [division, groupCount] of groupsByDivision) {
    for (let group = 1; group <= groupCount; group++) {
      for (let rank = 1; rank <= 8; rank++) {
        slots.push({
          id: `S${season}_LALPHA_D${division}_G${group}_R${rank}`,
          season,
          leagueId: 'ALPHA',
          division,
          group,
          rank,
          status: 'FREE',
          occupantId: null,
        });
      }
    }
  }

  assert.equal(slots.length, 120);
  assert.equal(new Set(slots.map((slot) => slot.id)).size, 120);
  assert.equal(new Set(slots.map((slot) => `${slot.division}:${slot.group}`)).size, 15);

  for (const [division, groupCount] of groupsByDivision) {
    const divisionSlots = slots.filter((slot) => slot.division === division);
    assert.equal(divisionSlots.length, groupCount * 8);
    for (let group = 1; group <= groupCount; group++) {
      const groupSlots = divisionSlots.filter((slot) => slot.group === group);
      assert.deepEqual(groupSlots.map((slot) => slot.rank).sort((a, b) => a - b), [1,2,3,4,5,6,7,8]);
      assert.ok(groupSlots.every((slot) => isEligibleRegistrationSlot(slot, season)));
    }
  }

  assert.equal(slots.filter((slot) => slot.division === 1).length, 8);
  assert.equal(slots.filter((slot) => slot.division === 2).length, 16);
  assert.equal(slots.filter((slot) => slot.division === 3).length, 32);
  assert.equal(slots.filter((slot) => slot.division === 4).length, 64);
});
