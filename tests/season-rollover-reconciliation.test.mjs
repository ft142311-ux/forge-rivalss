import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalSlotRepairs } from '../src/app/actions/season-rollover-standings.ts';

function canonicalFixtures() {
  const ids = Array.from({ length: 8 }, (_, i) => i === 3 ? 'BOT_ALPHA_L1_G1_R4' : i === 4 ? 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba' : `BOT_ALPHA_L1_G1_R${i + 1}`);
  const fixtures = [];
  for (let homeRank = 1; homeRank <= 8; homeRank++) {
    for (let awayRank = 1; awayRank <= 8; awayRank++) {
      if (homeRank === awayRank) continue;
      fixtures.push({
        homeId: ids[homeRank - 1], awayId: ids[awayRank - 1],
        homeRank, awayRank,
      });
    }
  }
  return fixtures;
}

function slots() {
  return Array.from({ length: 8 }, (_, i) => ({
    rank: i + 1,
    occupantId: i === 3 ? 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba' : null,
    status: i === 3 ? 'OCCUPIED' : 'FREE',
  }));
}

test('canonical slot repair moves a real participant to fixture rank and frees bot rank', () => {
  const repairs = buildCanonicalSlotRepairs(canonicalFixtures(), slots(), 8);
  assert.ok(repairs);
  assert.deepEqual(repairs[3], { rank: 4, occupantId: null, status: 'FREE' });
  assert.deepEqual(repairs[4], { rank: 5, occupantId: 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba', status: 'OCCUPIED' });
});

test('canonical slot repair refuses ambiguous slot ranks', () => {
  const brokenSlots = slots();
  brokenSlots[4].rank = 4;
  assert.equal(buildCanonicalSlotRepairs(canonicalFixtures(), brokenSlots, 8), null);
});

test('canonical slot repair refuses incomplete fixtures', () => {
  assert.equal(buildCanonicalSlotRepairs(canonicalFixtures().slice(0, 55), slots(), 8), null);
});


test('Season 1 recovery re-reads table and slot snapshots after repair writes', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../src/app/actions/season-rollover.ts', import.meta.url), 'utf8');
  const repairCommit = source.indexOf('if (repairWriteCount > 0) await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, repairWrites);');
  const refresh = source.indexOf('[tablesSnap, slotsSnap] = await Promise.all([', repairCommit);
  const consistencyGate = source.indexOf('const groupConsistency =', refresh);
  assert.ok(repairCommit >= 0, 'recovery repair commit must exist');
  assert.ok(refresh > repairCommit, 'table/slot snapshots must be refreshed after repair commit');
  assert.ok(consistencyGate > refresh, 'consistency validation must run only after refreshed snapshots are available');
});
