import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGroupStandings, evaluateRolloverPreflight, hasCanonicalFixtureStructure, hasCompleteCanonicalFixtureSet, inspectGroupReconciliation, selectFinishedFixtures } from '../src/app/actions/season-rollover-standings.ts';

const idsByRank = {
  1: 'BOT_ALPHA_L1_G1_R1',
  2: 'BOT_ALPHA_L1_G1_R2',
  3: 'BOT_ALPHA_L1_G1_R3',
  4: 'BOT_ALPHA_L1_G1_R4',
  5: 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba',
  6: 'BOT_ALPHA_L1_G1_R6',
  7: 'BOT_ALPHA_L1_G1_R7',
  8: 'BOT_ALPHA_L1_G1_R8',
};

function completeFixtures() {
  const fixtures = [];
  for (let homeRank = 1; homeRank <= 8; homeRank++) {
    for (let awayRank = 1; awayRank <= 8; awayRank++) {
      if (homeRank === awayRank) continue;
      fixtures.push({
        homeId: idsByRank[homeRank], homeRank,
        awayId: idsByRank[awayRank], awayRank,
        scoreA: homeRank < awayRank ? 2 : 1,
        scoreB: homeRank < awayRank ? 1 : 0,
        isFinished: true,
      });
    }
  }
  return fixtures;
}

test('final standings keep the current slot owner and aggregate results by rank', () => {
  const stats = {};
  for (let rank = 1; rank <= 8; rank++) {
    const id = idsByRank[rank];
    stats[id] = { id, name: rank === 6 ? 'Zulu Six' : id, rank, points: 99, isBot: id.startsWith('BOT_') };
  }
  const staleBotId = 'BOT_ALPHA_L1_G1_R5';
  stats[staleBotId] = { id: staleBotId, name: 'Old Bot', rank: 5, points: 999, isBot: true };

  const slots = Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    const id = idsByRank[rank];
    return id.startsWith('BOT_')
      ? { rank, status: 'FREE', occupantId: null }
      : { rank, status: 'OCCUPIED', occupantId: id };
  });
  const matches = completeFixtures();

  assert.equal(hasCompleteCanonicalFixtureSet(matches), true);
  const standings = calculateGroupStandings(stats, matches, 8, slots);
  assert.equal(standings.length, 8);
  assert.deepEqual(
    standings.map(team => team.id).sort(),
    Object.values(idsByRank).sort(),
  );
  assert.deepEqual(standings.map(team => team.rank).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(standings.map(team => team.id)).size, 8);
  const byId = new Map(standings.map(team => [team.id, team]));
  assert.equal(byId.get(idsByRank[5]).rank, 5);
  assert.equal(byId.get(idsByRank[5]).matchesPlayed, 14);
  assert.equal(byId.get('BOT_ALPHA_L1_G1_R4').matchesPlayed, 14);
  assert.equal(byId.get(staleBotId), undefined);
});

test('completed results from several previous owners are aggregated into the current slot owner', () => {
  const stats = Object.fromEntries(Object.entries(idsByRank).map(([rank, id]) => [id, {
    id, name: id, rank: Number(rank), isBot: id.startsWith('BOT_'),
  }]));
  const currentOwner = idsByRank[5];
  const oldOwners = ['BOT_ALPHA_L1_G1_R5', 'OLD_USER_R5'];
  const fixtures = completeFixtures();
  let replaced = 0;
  for (const fixture of fixtures) {
    if (fixture.homeRank === 5 || fixture.awayRank === 5) {
      const oldId = oldOwners[replaced % oldOwners.length];
      if (fixture.homeRank === 5) fixture.homeId = oldId;
      else fixture.awayId = oldId;
      replaced++;
    }
  }
  const slots = Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    const id = idsByRank[rank];
    return id.startsWith('BOT_')
      ? { rank, status: 'FREE', occupantId: null }
      : { rank, status: 'OCCUPIED', occupantId: id };
  });

  assert.equal(hasCanonicalFixtureStructure(fixtures), true);
  const inspection = inspectGroupReconciliation(stats, fixtures, slots);
  assert.equal(inspection.ready, true);
  assert.equal(inspection.staleRows.length, 0);
  const standings = calculateGroupStandings(stats, fixtures, 8, slots);
  const currentRow = standings.find(row => row.id === currentOwner);
  assert.ok(currentRow);
  assert.equal(currentRow.matchesPlayed, 14);
  assert.equal(standings.some(row => oldOwners.includes(row.id)), false);
});

test('incomplete standings keep the current slot identity while aggregating saved results by rank', () => {
  const stats = {
    NEW_TEAM: { id: 'NEW_TEAM', rank: 5, points: 7 },
    OTHER_TEAM: { id: 'OTHER_TEAM', rank: 4, points: 3 },
  };
  const fixtures = [{ homeId: 'OTHER_TEAM', homeRank: 4, awayId: 'NEW_TEAM', awayRank: 5, scoreA: 2, scoreB: 1 }];

  assert.equal(hasCompleteCanonicalFixtureSet(fixtures), false);
  const standings = calculateGroupStandings(stats, fixtures);
  assert.equal(standings.some(team => team.id === 'NEW_TEAM'), true);
  assert.equal(standings.some(team => team.id === 'OLD_TEAM'), false);
});

test('active-season standings rebuild uses saved results while the remaining canonical fixtures are pending', () => {
  const stats = Object.fromEntries(Object.entries(idsByRank).map(([rank, id]) => [id, {
    id, rank: Number(rank), matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0,
  }]));
  const fixtures = [{
    homeId: idsByRank[1], homeName: 'Team 1', homeRank: 1,
    awayId: idsByRank[2], awayName: 'Team 2', awayRank: 2,
    scoreA: 2, scoreB: 0, isFinished: true, status: 'finished',
  }, {
    homeId: idsByRank[1], homeRank: 1, awayId: idsByRank[3], awayRank: 3,
    scoreA: 0, scoreB: 0, isFinished: false, status: 'scheduled',
  }];
  const results = selectFinishedFixtures(fixtures);
  const standings = calculateGroupStandings(stats, results);
  const byId = new Map(standings.map(row => [row.id, row]));
  assert.equal(standings.length, 8);
  assert.equal(byId.get(idsByRank[1]).matchesPlayed, 1);
  assert.equal(byId.get(idsByRank[1]).wins, 1);
  assert.equal(byId.get(idsByRank[1]).points, 3);
  assert.equal(byId.get(idsByRank[2]).losses, 1);
  assert.equal(results.length, 1);
  assert.equal([...byId.values()].reduce((sum, row) => sum + row.matchesPlayed, 0), 2);
});

test('duplicate participant IDs or fixture coordinates are not a complete canonical set', () => {
  const fixtures = completeFixtures();
  fixtures[1].awayId = fixtures[0].homeId;
  assert.equal(hasCompleteCanonicalFixtureSet(fixtures), false);

  const duplicateCoordinates = completeFixtures();
  duplicateCoordinates[1].homeRank = duplicateCoordinates[0].homeRank;
  duplicateCoordinates[1].awayRank = duplicateCoordinates[0].awayRank;
  assert.equal(hasCompleteCanonicalFixtureSet(duplicateCoordinates), false);
});

test('requires explicit completion and rejects contradictory terminal status', () => {
  const withoutCompletion = completeFixtures();
  delete withoutCompletion[0].isFinished;
  assert.equal(hasCompleteCanonicalFixtureSet(withoutCompletion), false);

  const scheduled = completeFixtures();
  scheduled[0].status = 'scheduled';
  assert.equal(hasCompleteCanonicalFixtureSet(scheduled), false);

  const terminal = completeFixtures();
  terminal[0].status = 'finished';
  assert.equal(hasCompleteCanonicalFixtureSet(terminal), true);

  const contradictory = completeFixtures();
  contradictory[0].isFinished = false;
  contradictory[0].status = 'finished';
  assert.equal(hasCompleteCanonicalFixtureSet(contradictory), false);
});

test('rollover may settle unfinished results only when fixture structure is canonical', () => {
  const unfinished = completeFixtures();
  unfinished[0].isFinished = false;
  delete unfinished[0].scoreA;
  delete unfinished[0].scoreB;
  const inspection = inspectGroupReconciliation({}, unfinished, Array.from({ length: 8 }, (_, index) => ({
    rank: index + 1,
    occupantId: String(idsByRank[index + 1]).startsWith('BOT_') ? '' : idsByRank[index + 1],
  })));
  assert.equal(hasCanonicalFixtureStructure(unfinished), true);
  assert.equal(inspection.completeFixtures, false);
  assert.equal(evaluateRolloverPreflight([{ group: 'D1-G1', ...inspection }], { allowUnfinished: true }).ready, true);
  assert.equal(evaluateRolloverPreflight([{ group: 'D1-G1', ...inspection }]).ready, false);
});

test('stale standings rows block rollover instead of being silently promoted', () => {
  const inspection = inspectGroupReconciliation({
    ...Object.fromEntries(Object.values(idsByRank).map((id, index) => [id, { id, rank: index + 1 }])),
    STALE_TEAM: { id: 'STALE_TEAM', rank: 8 },
  }, completeFixtures(), Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    const id = idsByRank[rank];
    return id.startsWith('BOT_')
      ? { rank, status: 'FREE', occupantId: null }
      : { rank, status: 'OCCUPIED', occupantId: id };
  }));
  assert.equal(inspection.reasons.includes('STALE_STANDINGS_ROWS'), true);
  const result = evaluateRolloverPreflight([{ group: 'D1-G1', ...inspection }]);
  assert.equal(result.ready, false);
  assert.deepEqual(result.failedGroups, ['D1-G1']);
});

test('reports duplicate source ranks without hiding the fixture-derived result', () => {
  const fixtures = completeFixtures();
  const inspection = inspectGroupReconciliation({
    A: { id: 'A', rank: 4 },
    B: { id: 'B', rank: 4 },
  }, fixtures);
  assert.equal(inspection.completeFixtures, true);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.reasons.includes('SOURCE_DUPLICATE_RANK'), true);
  assert.equal(inspection.standings.length, 8);
});

test('reports slot/fixture mismatch without changing the slot projection', () => {
  const fixtures = completeFixtures();
  const slots = Array.from({ length: 8 }, (_, index) => ({
    rank: index + 1,
    status: index + 1 === 4 ? 'OCCUPIED' : 'FREE',
    occupantId: index + 1 === 4 ? idsByRank[5] : null,
  }));
  const before = structuredClone(slots);
  const currentStats = Object.fromEntries(Object.entries(idsByRank).map(([rank, id]) => [id, {
    id, rank: Number(rank), isBot: id.startsWith('BOT_'),
  }]));
  const inspection = inspectGroupReconciliation(currentStats, fixtures, slots);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.reasons.includes('SLOT_FIXTURE_PARTICIPANT_MISMATCH'), true);
  assert.ok(inspection.slotConflicts.some(conflict => conflict.rank === 4));
  assert.deepEqual(slots, before);
});

test('rollover preflight explicitly refuses a slot/fixture conflict', () => {
  const currentStats = Object.fromEntries(Object.entries(idsByRank).map(([rank, id]) => [id, {
    id, rank: Number(rank), isBot: id.startsWith('BOT_'),
  }]));
  const inspection = inspectGroupReconciliation(currentStats, completeFixtures(), [
    { rank: 4, status: 'OCCUPIED', occupantId: idsByRank[5] },
  ]);
  const result = evaluateRolloverPreflight([{ group: 'D1-G1', ...inspection }]);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SEASON_STANDINGS_SLOTS_FIXTURE_CONFLICT');
  assert.deepEqual(result.failedGroups, ['D1-G1']);
});

test('rollover preflight rejects duplicate slot ranks even when the slot count is eight', () => {
  const currentStats = Object.fromEntries(Object.entries(idsByRank).map(([rank, id]) => [id, {
    id, rank: Number(rank), isBot: id.startsWith('BOT_'),
  }]));
  const slots = Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    const id = idsByRank[rank];
    return id.startsWith('BOT_')
      ? { rank, status: 'FREE', occupantId: null }
      : { rank, status: 'OCCUPIED', occupantId: id };
  });
  slots[7] = { ...slots[7], rank: 7 };

  const inspection = inspectGroupReconciliation(currentStats, completeFixtures(), slots);
  assert.equal(inspection.ready, false);
  assert.ok(inspection.reasons.includes('DUPLICATE_SLOT_RANKS'));
  assert.ok(inspection.reasons.includes('INCOMPLETE_SLOT_SET'));
});

test('rollover preflight refuses an incomplete slot set even without an occupant conflict', () => {
  const inspection = inspectGroupReconciliation({}, completeFixtures(), []);
  const result = evaluateRolloverPreflight([{ group: 'D1-G1', ...inspection }]);
  assert.equal(inspection.reasons.includes('INCOMPLETE_SLOT_SET'), true);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SEASON_STANDINGS_PREFLIGHT_FAILED');
});

test('D3-G1 standings projection includes a late 14th finished result and recomputes every counter', () => {
  const ids = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, `D3_TEAM_R${index + 1}`]));
  const fixtures = [];
  for (let homeRank = 1; homeRank <= 8; homeRank++) {
    for (let awayRank = 1; awayRank <= 8; awayRank++) {
      if (homeRank === awayRank) continue;
      fixtures.push({
        homeId: ids[homeRank], homeRank, awayId: ids[awayRank], awayRank,
        scoreA: homeRank === 2 && awayRank === 1 ? 0 : 2,
        scoreB: homeRank === 2 && awayRank === 1 ? 2 : 0,
        isFinished: true, status: 'finished',
      });
    }
  }
  const stale = Object.fromEntries(Object.entries(ids).map(([rank, id]) => [id, {
    id, name: id, rank: Number(rank), matchesPlayed: 13, wins: 0, draws: 0,
    losses: 0, points: 0, diff: 0,
  }]));
  stale[ids[2]] = { ...stale[ids[2]], matchesPlayed: 13, wins: 10, draws: 3, losses: 0, points: 33, diff: 20 };
  stale[ids[1]] = { ...stale[ids[1]], matchesPlayed: 13, wins: 1, draws: 3, losses: 9, points: 6, diff: -16 };

  const rebuilt = Object.fromEntries(calculateGroupStandings(stale, fixtures).map(row => [row.id, row]));
  assert.equal(rebuilt[ids[2]].matchesPlayed, 14);
  assert.equal(rebuilt[ids[2]].wins, 6);
  assert.equal(rebuilt[ids[2]].points, 18);
  assert.equal(rebuilt[ids[2]].losses, 8);
  assert.equal(rebuilt[ids[2]].diff, -4);
  assert.equal(rebuilt[ids[1]].matchesPlayed, 14);
  assert.equal(rebuilt[ids[1]].wins, 8);
  assert.equal(rebuilt[ids[1]].losses, 6);
  assert.equal(rebuilt[ids[1]].points, 24);
  assert.equal(rebuilt[ids[1]].diff, 4);
});



