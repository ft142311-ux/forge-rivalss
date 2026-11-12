import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCarryForwardGroups } from '../src/app/actions/season-rollover-plan.ts';

function sourceGroups() {
  const result = {};
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const key = `D${level}-G${group}`;
      result[key] = Array.from({ length: 8 }, (_, index) => ({
        id: `TEAM_${level}_${group}_${index + 1}`,
        rank: index + 1,
        name: `Team ${level}-${group}-${index + 1}`,
        points: 99,
        matchesPlayed: 14,
      }));
    }
  }
  return result;
}

test('carry-forward preserves all 120 identities and ranks without promotion or relegation', () => {
  const result = buildCarryForwardGroups(sourceGroups());
  assert.equal(result.ready, true);
  assert.equal(Object.keys(result.groups).length, 15);
  assert.equal(Object.values(result.groups).reduce((sum, rows) => sum + rows.length, 0), 120);
  assert.equal(result.groups['D3-G2'][6].id, 'TEAM_3_2_7');
  assert.equal(result.groups['D3-G2'][6].rank, 7);
  assert.equal(result.groups['D3-G2'][6].points, 0);
  assert.equal(result.groups['D3-G2'][6].matchesPlayed, 0);
});

test('carry-forward rejects missing ranks instead of inventing replacement teams', () => {
  const groups = sourceGroups();
  groups['D2-G1'] = groups['D2-G1'].filter(row => row.rank !== 8);
  const result = buildCarryForwardGroups(groups);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'CARRY_FORWARD_GROUP_INCOMPLETE');
  assert.equal(result.group, 'D2-G1');
});

test('carry-forward rejects duplicate team identities across groups', () => {
  const groups = sourceGroups();
  groups['D4-G8'][0].id = groups['D1-G1'][0].id;
  const result = buildCarryForwardGroups(groups);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'CARRY_FORWARD_TEAM_OR_RANK_CONFLICT');
});

test('carry-forward rejects unexpected groups', () => {
  const groups = sourceGroups();
  groups['D5-G1'] = [];
  const result = buildCarryForwardGroups(groups);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'CARRY_FORWARD_UNEXPECTED_GROUP');
});



test('obsolete rollover plan pruning validates document identity and retains only the target plan', async () => {
  const { resolveRolloverPlanPruneIds } = await import('../src/app/actions/season-rollover-plan.ts');
  assert.equal(resolveRolloverPlanPruneIds([{ id: 'legacy', plan: {} }], 3).ready, false);
  assert.equal(resolveRolloverPlanPruneIds([{ id: 'S2', plan: { sourceSeason: 1, targetSeason: 3, ready: true } }], 3).ready, false);

  const groups = sourceGroups();
  const oldPlan = { sourceSeason: 1, targetSeason: 2, ready: true, groups };
  const targetPlan = { sourceSeason: 2, targetSeason: 3, ready: true, groups };
  const result = resolveRolloverPlanPruneIds([
    { id: 'S2', plan: oldPlan },
    { id: 'S3', plan: targetPlan },
  ], 3);
  assert.equal(result.ready, true);
  assert.deepEqual(result.pruneIds, ['S2']);
});


test('recovery placement uses the newest trusted baseline and never reapplies older promotion twice', async () => {
  const { resolveRecoveryPlacementSource } = await import('../src/app/actions/season-rollover-plan.ts');
  assert.equal(resolveRecoveryPlacementSource(1, 2), 'recovered_participants');
  assert.equal(resolveRecoveryPlacementSource(3, 2), 'completed_archive');
  assert.equal(resolveRecoveryPlacementSource(3, null), 'completed_archive');
  assert.equal(resolveRecoveryPlacementSource(null, 2), 'recovered_participants');
  assert.equal(resolveRecoveryPlacementSource(null, null), 'active_slots');
});
