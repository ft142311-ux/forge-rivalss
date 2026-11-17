import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { commitSeasonActivation } from '../src/app/actions/season-activation-commit.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

test('season activation commits once in Firestore Emulator and leaves a durable cleanup retry marker', {
  skip: !emulatorHost,
}, async (t) => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');

  const app = initializeApp({ projectId }, `season-activation-test-${randomUUID()}`);
  const db = getFirestore(app);
  const runId = randomUUID();
  const configRef = db.collection('seasonLifecycleIntegrationTests').doc(`${runId}-config`);
  const planRef = db.collection('seasonLifecycleIntegrationTests').doc(`${runId}-S2-plan`);

  t.after(async () => {
    await Promise.all([
      configRef.delete().catch(() => undefined),
      planRef.delete().catch(() => undefined),
      deleteApp(app),
    ]);
  });

  const activationAtMs = 10_000;
  const nextSeasonStartMs = 20_000;
  await configRef.set({
    activeSeasonNumber: 1,
    nextSeasonNumber: 2,
    preparationTargetSeason: 2,
    preparedSeasonNumber: 2,
    worldReady: true,
    preparedWorldReady: true,
    preparedPublished: true,
    preparedCalendarRevision: 4,
    preparedSeasonStart: new Date(activationAtMs).toISOString(),
    preparedNextSeasonStart: new Date(nextSeasonStartMs).toISOString(),
    nextSeasonStart: new Date(activationAtMs).toISOString(),
    preparedRecoveryMode: false,
    phase: 'PUBLISHED',
    historyCleanupPending: false,
  });
  await planRef.set({ sourceSeason: 1, targetSeason: 2, ready: true });

  const expected = {
    sourceSeason: 1,
    targetSeason: 2,
    calendarRevision: 4,
    activationAtMs,
    nextSeasonStartMs,
    multiSeasonRecovery: false,
    recoveryMode: false,
    nowMs: 15_000,
    isPlanReady: (plan, current) =>
      plan?.ready === true &&
      Number(plan.sourceSeason) === 1 &&
      Number(plan.targetSeason) === 2 &&
      Number(current.preparedSeasonNumber) === 2,
    buildUpdate: current => ({
      activeSeasonNumber: 2,
      phase: 'REGULAR_SEASON',
      worldReady: true,
      seasonStart: current.preparedSeasonStart,
      nextSeasonStart: current.preparedNextSeasonStart,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 2,
      preparedSeasonNumber: null,
    }),
  };

  const attempts = await Promise.all([
    commitSeasonActivation(db, configRef, planRef, expected),
    commitSeasonActivation(db, configRef, planRef, expected),
  ]);

  assert.equal(attempts.filter(result => result.success === true).length, 1);
  assert.equal(attempts.filter(result => result.reason === 'ACTIVATION_STATE_CHANGED').length, 1);

  const activated = (await configRef.get()).data();
  assert.equal(activated.activeSeasonNumber, 2);
  assert.equal(activated.phase, 'REGULAR_SEASON');
  assert.equal(activated.worldReady, true);
  assert.equal(activated.historyCleanupPending, true);
  assert.equal(activated.historyCleanupTargetSeason, 2);
  assert.equal(activated.preparedSeasonNumber, null);

  const retry = await commitSeasonActivation(db, configRef, planRef, expected);
  assert.deepEqual(retry, { success: false, reason: 'ACTIVATION_STATE_CHANGED' });
  assert.equal((await configRef.get()).get('activeSeasonNumber'), 2);
});
