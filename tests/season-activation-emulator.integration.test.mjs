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


test('Firestore Emulator Season 1 to 2 activation preserves human club identity, roster, and occupied league slot', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');

  const app = initializeApp({ projectId }, `season-activation-preservation-${randomUUID()}`);
  const db = getFirestore(app);
  const runId = randomUUID();
  const configRef = db.collection('seasonLifecycleIntegrationTests').doc(`${runId}-config`);
  const planRef = db.collection('seasonLifecycleIntegrationTests').doc(`${runId}-S2-plan`);
  const humanId = `human-${runId}`;
  const profileRef = db.collection('players_v14').doc(humanId);
  const slotRef = db.collection('league_slots_v1').doc(`test-season-activation-${runId}-slot`);
  const sourceFixtureRef = db.collection('matches_v2').doc(`test-season-activation-${runId}-fixture`);
  const expectedProfile = {
    id: humanId,
    uid: humanId,
    clubName: 'Human Club — Season One',
    displayName: 'Human Club — Season One',
    credits: 123456,
    ownedPlayers: Array.from({ length: 10 }, (_, index) => ({
      id: `human-${runId}-player-${index + 1}`,
      name: `Player ${index + 1}`,
      overallRating: 27 + (index % 3),
    })),
  };
  const expectedSlot = {
    season: 1,
    leagueId: 'ALPHA',
    division: 2,
    group: 1,
    rank: 3,
    status: 'OCCUPIED',
    occupantId: expectedProfile.uid,
    occupancyGeneration: 7,
  };
  const expectedFixture = {
    season: 1,
    version: 140,
    homeId: expectedProfile.uid,
    awayId: 'BOT_ALPHA_L2_G1_R4',
    status: 'finished',
    isFinished: true,
    scoreA: 2,
    scoreB: 1,
  };

  t.after(async () => {
    await Promise.all([
      configRef.delete().catch(() => undefined),
      planRef.delete().catch(() => undefined),
      profileRef.delete().catch(() => undefined),
      slotRef.delete().catch(() => undefined),
      sourceFixtureRef.delete().catch(() => undefined),
      deleteApp(app),
    ]);
  });

  const activationAtMs = 10_000;
  const nextSeasonStartMs = 20_000;
  await Promise.all([
    configRef.set({
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
    }),
    planRef.set({ sourceSeason: 1, targetSeason: 2, ready: true }),
    profileRef.set(expectedProfile),
    slotRef.set(expectedSlot),
    sourceFixtureRef.set(expectedFixture),
  ]);

  const before = await Promise.all([
    profileRef.get(),
    slotRef.get(),
    sourceFixtureRef.get(),
  ]);
  const profileBefore = before[0].data();
  const slotBefore = before[1].data();
  const fixtureBefore = before[2].data();

  const result = await commitSeasonActivation(db, configRef, planRef, {
    sourceSeason: 1,
    targetSeason: 2,
    calendarRevision: 4,
    activationAtMs,
    nextSeasonStartMs,
    multiSeasonRecovery: false,
    recoveryMode: false,
    nowMs: 15_000,
    isPlanReady: plan => plan?.ready === true &&
      Number(plan.sourceSeason) === 1 &&
      Number(plan.targetSeason) === 2,
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
  });

  assert.deepEqual(result, { success: true });
  assert.equal((await configRef.get()).get('activeSeasonNumber'), 2);
  assert.deepEqual((await profileRef.get()).data(), profileBefore);
  assert.deepEqual((await slotRef.get()).data(), slotBefore);
  assert.deepEqual((await sourceFixtureRef.get()).data(), fixtureBefore);
  assert.equal((await profileRef.get()).get('uid'), expectedProfile.uid);
  assert.equal((await slotRef.get()).get('occupantId'), expectedProfile.uid);
  assert.equal((await profileRef.get()).get('ownedPlayers').length, 10);
});
