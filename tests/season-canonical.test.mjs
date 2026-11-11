import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCanonicalDocuments } from '../src/app/actions/season-canonical.ts';

function fixtureWorld() {
  const tables = [];
  const slots = [];
  const matches = [];
  for (let group = 1; group <= 15; group++) {
    const level = group === 1 ? 1 : group <= 3 ? 2 : group <= 7 ? 3 : 4;
    const localGroup = group === 1 ? 1 : group <= 3 ? group - 1 : group <= 7 ? group - 3 : group - 7;
    const stats = {};
    for (let rank = 1; rank <= 8; rank++) {
      const id = `BOT_${group}_${rank}`;
      stats[id] = { id, rank };
      slots.push({ division: level, group: localGroup, rank, status: 'FREE', occupantId: null });
      for (let away = 1; away <= 8; away++) {
        if (rank !== away) matches.push({ level, groupId: localGroup, homeRank: rank, awayRank: away, homeId: id, awayId: `BOT_${group}_${away}` });
      }
    }
    tables.push({ leagueId: 'ALPHA', level, group: localGroup, stats });
  }
  return { tables, slots, matches };
}

test('accepts a complete canonical world', () => {
  assert.equal(evaluateCanonicalDocuments(fixtureWorld()).ready, true);
});

test('rejects duplicate clubs across tables', () => {
  const world = fixtureWorld();
  world.tables[1].stats.BOT_1_1 = { id: 'BOT_1_1', rank: 1 };
  delete world.tables[1].stats.BOT_2_1;
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects tables from another league', () => {
  const world = fixtureWorld();
  world.tables[0].leagueId = 'BETA';
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects a table row without its own ID', () => {
  const world = fixtureWorld();
  delete world.tables[0].stats.BOT_1_1.id;
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects incomplete slots', () => {
  const world = fixtureWorld();
  world.slots.pop();
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects table and occupied-slot participant mismatch', () => {
  const world = fixtureWorld();
  world.tables[0].stats.BOT_1_1 = { id: 'CLUB_A', rank: 1 };
  world.slots[0] = { division: 1, group: 1, rank: 1, status: 'OCCUPIED', occupantId: 'CLUB_B' };
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects duplicate occupants across slots', () => {
  const world = fixtureWorld();
  world.slots[0] = { division: 1, group: 1, rank: 1, status: 'OCCUPIED', occupantId: 'CLUB_A' };
  world.slots[8] = { division: 2, group: 1, rank: 1, status: 'OCCUPIED', occupantId: 'CLUB_A' };
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects an incomplete canonical fixture set', () => {
  const world = fixtureWorld();
  world.matches.pop();
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
});

test('rejects fixtures that reference a team absent from that group table', () => {
  const world = fixtureWorld();
  world.matches[0].homeId = 'UNKNOWN_TEAM';
  assert.equal(evaluateCanonicalDocuments(world).ready, false);
  assert.ok(evaluateCanonicalDocuments(world).reasons.includes('MATCH_PARTICIPANT_TABLE_MISMATCH'));
});

test('active-season table rank changes do not detach participants from their original fixture slots', () => {
  const world = fixtureWorld();
  const table = world.tables[0];
  const oldOne = table.stats.BOT_1_1;
  const oldTwo = table.stats.BOT_1_2;
  delete table.stats.BOT_1_1;
  table.stats.CLUB_A = { id: 'CLUB_A', rank: 2 };
  table.stats.BOT_1_2 = { ...oldTwo, rank: 1 };
  world.matches.filter(match => match.level === 1 && match.groupId === 1).forEach(match => {
    if (match.homeRank === 1) match.homeId = 'CLUB_A';
    if (match.awayRank === 1) match.awayId = 'CLUB_A';
  });
  world.slots[0] = { division: 1, group: 1, rank: 1, status: 'OCCUPIED', occupantId: 'CLUB_A' };
  assert.equal(oldOne.id, 'BOT_1_1');
  assert.equal(evaluateCanonicalDocuments(world).ready, true);
});
