import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRecoveryRolloverDecision } from '../src/app/actions/season-recovery-publication.ts';
import { compareRecoveryRolloverPlans } from '../src/app/actions/season-rollover-plan.ts';
import { resolvePendingSkippedHistoryMarker } from '../src/app/actions/season-history-policy.ts';

function makeFixture({ batchLimit = 2 } = {}) {
  const store = new Map();
  const planRef = 'rollover:S4';
  const historyEntries = [
    { seasonNumber: 2, reason: 'SEASON_INCOMPLETE', ref: 'history:S2' },
    { seasonNumber: 3, reason: 'NO_CANONICAL_RESULTS', ref: 'history:S3' },
  ];
  const groups = Object.fromEntries(Array.from({ length: 15 }, (_, index) => {
    const level = Math.floor(Math.log2(index + 1)) + 1;
    const firstGroup = 2 ** (level - 1) - 1;
    const group = index - firstGroup + 1;
    return [`D${level}-G${group}`, Array.from({ length: 8 }, (_, rank) => ({
      id: `D${level}-G${group}-T${rank + 1}`, rank: rank + 1,
    }))];
  }));
  const plan = {
    sourceSeason: 3,
    targetSeason: 4,
    leagueId: 'ALPHA',
    ready: true,
    mode: 'recovery_carry_forward',
    skippedSeasons: historyEntries.map(({ seasonNumber, reason }) => ({ seasonNumber, reason })),
    lastTrustedSeason: 1,
    placementSource: 'recovered_participants',
    retainedArchiveSeason: 1,
    promotionRule: 'carry_forward_without_promotion_or_relegation',
    groups,
  };
  let historyCommitCalls = 0;
  let failHistoryMode = null;
  const args = {
    planRef,
    plan,
    historyEntries,
    targetSeason: 4,
    batchLimit,
    read: async ref => store.has(ref) ? structuredClone(store.get(ref)) : null,
    commitPlan: async (ref, value) => { store.set(ref, structuredClone(value)); },
    commitHistory: async writes => {
      historyCommitCalls++;
      if (failHistoryMode === 'before-first-write') {
        failHistoryMode = null;
        throw new Error('INJECTED_CRASH_BEFORE_HISTORY');
      }
      if (failHistoryMode === 'after-first-write' && historyCommitCalls === 1) {
        store.set(writes[0].ref, structuredClone(writes[0].data));
        failHistoryMode = null;
        throw new Error('INJECTED_CRASH_AFTER_FIRST_HISTORY');
      }
      for (const write of writes) store.set(write.ref, structuredClone(write.data));
    },
    comparePlans: compareRecoveryRolloverPlans,
    resolvePendingMarker: resolvePendingSkippedHistoryMarker,
    buildPendingMarker: (entry, targetSeason) => ({
      seasonNumber: entry.seasonNumber,
      status: 'SKIPPED_PENDING_ACTIVATION',
      reason: entry.reason,
      targetSeason,
      noResultsFabricated: true,
      awardsApplied: false,
      promotionRelegationApplied: false,
    }),
  };
  return {
    args,
    store,
    planRef,
    historyEntries,
    setFailure(mode) { failHistoryMode = mode; historyCommitCalls = 0; },
    getHistoryCommitCalls() { return historyCommitCalls; },
  };
}

test('crash after durable plan publication resumes by writing missing history markers only', async () => {
  const fixture = makeFixture();
  fixture.setFailure('before-first-write');
  await assert.rejects(
    () => publishRecoveryRolloverDecision(fixture.args),
    /INJECTED_CRASH_BEFORE_HISTORY/,
  );
  assert.ok(fixture.store.has(fixture.planRef));
  assert.equal(fixture.store.has('history:S2'), false);
  assert.equal(fixture.store.has('history:S3'), false);

  const firstPlan = structuredClone(fixture.store.get(fixture.planRef));
  const retry = await publishRecoveryRolloverDecision(fixture.args);
  assert.equal(retry.ready, true);
  assert.deepEqual(retry.plan, firstPlan);
  assert.deepEqual(fixture.store.get('history:S2'), fixture.args.buildPendingMarker(fixture.historyEntries[0], 4));
  assert.deepEqual(fixture.store.get('history:S3'), fixture.args.buildPendingMarker(fixture.historyEntries[1], 4));
});

test('crash between history chunks resumes without rewriting already committed markers', async () => {
  const fixture = makeFixture({ batchLimit: 1 });
  fixture.setFailure('after-first-write');
  await assert.rejects(
    () => publishRecoveryRolloverDecision(fixture.args),
    /INJECTED_CRASH_AFTER_FIRST_HISTORY/,
  );
  assert.ok(fixture.store.has(fixture.planRef));
  assert.ok(fixture.store.has('history:S2'));
  assert.equal(fixture.store.has('history:S3'), false);

  const firstMarker = structuredClone(fixture.store.get('history:S2'));
  fixture.setFailure(null);
  const retry = await publishRecoveryRolloverDecision(fixture.args);
  assert.equal(retry.ready, true);
  assert.deepEqual(fixture.store.get('history:S2'), firstMarker);
  assert.ok(fixture.store.has('history:S3'));
  assert.equal(fixture.getHistoryCommitCalls(), 1);
});

test('conflicting history marker blocks plan publication before any write', async () => {
  const fixture = makeFixture();
  fixture.store.set('history:S3', {
    seasonNumber: 3,
    status: 'SKIPPED',
    reason: 'NO_CANONICAL_RESULTS',
    activatedTargetSeason: 4,
    noResultsFabricated: true,
    awardsApplied: false,
    promotionRelegationApplied: false,
  });
  const result = await publishRecoveryRolloverDecision(fixture.args);
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SKIPPED_SEASON_HISTORY_CONFLICT');
  assert.equal(fixture.store.has(fixture.planRef), false);
  assert.equal(fixture.store.has('history:S2'), false);
});
