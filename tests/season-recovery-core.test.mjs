import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeasonRecoveryDocuments, buildSeasonTwoRecoveryDocuments, isValidSeasonTwoRecoveryResult } from '../src/app/actions/season-recovery-core.ts';
import { expectedRolloverGroups } from '../src/app/actions/season-rollover-plan.ts';

function validS2Plan() {
  const groups = {};
  for (const key of expectedRolloverGroups()) {
    groups[key] = Array.from({ length: 8 }, (_, index) => ({
      id: index % 3 !== 0 ? `BOT_${key}_TEAM-${index + 1}` : `${key}-TEAM-${index + 1}`,
      name: `${key} Team ${index + 1}`,
      rank: index + 1,
      isBot: index % 3 !== 0,
    }));
  }
  return { sourceSeason: 1, targetSeason: 2, leagueId: 'ALPHA', ready: true, groups };
}

test('builds the complete canonical S2 schedule from the saved S1→S2 plan without publishing S2', () => {
  const start = new Date('2026-10-08T15:00:00.000Z');
  const built = buildSeasonTwoRecoveryDocuments(validS2Plan(), start);
  assert.equal(built.readiness.ready, true);
  assert.equal(built.tables.length, 15);
  assert.equal(built.slots.length, 120);
  assert.equal(built.matches.length, 840);
  assert.equal(new Set(built.matches.map(item => item.id)).size, 840);
  assert.equal(built.matches.every(item => item.data.season === 2 && item.data.isFinished === false && item.data.status === 'scheduled'), true);
  assert.equal(Math.min(...built.matches.map(item => Date.parse(item.data.startTime))), Date.parse('2026-10-08T15:00:00.000Z'));
  assert.equal(Math.max(...built.matches.map(item => Date.parse(item.data.startTime))), Date.parse('2026-10-21T15:00:00.000Z'));
  assert.equal(built.tables.every(table => Object.keys(table.data.stats).length === 8), true);
  assert.equal(built.slots.filter(slot => slot.data.status === 'OCCUPIED').length, 45);
});

test('refuses an invalid saved placement plan instead of guessing participants', () => {
  const plan = validS2Plan();
  plan.groups['D1-G1'][1].rank = 1;
  assert.throws(() => buildSeasonTwoRecoveryDocuments(plan, new Date('2026-10-08T15:00:00.000Z')), /ROLLOVER_PLAN_SLOT_CONFLICT/);
});

test('builds a canonical S3 recovery schedule only from the validated S2→S3 placement plan', () => {
  const plan = validS2Plan();
  plan.sourceSeason = 2;
  plan.targetSeason = 3;
  const built = buildSeasonRecoveryDocuments(plan, 2, 3, new Date('2026-10-23T15:00:00.000Z'));
  assert.equal(built.readiness.ready, true);
  assert.equal(built.tables.length, 15);
  assert.equal(built.slots.length, 120);
  assert.equal(built.matches.length, 840);
  assert.equal(built.matches.every(item => item.data.season === 3 && item.id.includes('_S3_')), true);
  assert.equal(Math.min(...built.matches.map(item => Date.parse(item.data.startTime))), Date.parse('2026-10-23T15:00:00.000Z'));
  assert.throws(() => buildSeasonRecoveryDocuments(plan, 1, 3, new Date('2026-10-23T15:00:00.000Z')), /ROLLOVER_PLAN_METADATA_INVALID/);
});

test('preserves only confirmed final scores as results', () => {
  assert.equal(isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA: 2, scoreB: 1 }), true);
  assert.equal(isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA: 0, scoreB: 0 }), false);
  assert.equal(isValidSeasonTwoRecoveryResult({ status: 'processing', isFinished: false, scoreA: 2, scoreB: 0 }), false);
  assert.equal(isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA: 3, scoreB: 0 }), false);
});
