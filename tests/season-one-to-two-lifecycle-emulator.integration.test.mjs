import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { prepareSeasonRollover } from '../src/app/actions/season-rollover.ts';
import { commitSeasonActivation } from '../src/app/actions/season-activation-commit.ts';
import { calculateGroupStandings } from '../src/app/actions/season-rollover-standings.ts';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan.ts';
import { isRolloverPlanPublicationReady } from '../src/app/actions/season-awards-policy.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';
const DAY_MS = 24 * 60 * 60 * 1000;

function buildRoundRobinFixtures(level, group) {
  const teams = Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    const isHuman = level === 1 && group === 1 && rank === 1;
    return {
      id: isHuman ? 'HUMAN_SEASON_LIFECYCLE' : `BOT_ALPHA_L${level}_G${group}_R${rank}`,
      name: isHuman ? 'Season Lifecycle Human Club' : `Bot D${level} G${group} R${rank}`,
      rank,
    };
  });
  const firstLeg = [];
  let rotation = [...teams];
  for (let round = 1; round <= 7; round++) {
    for (let index = 0; index < 4; index++) {
      firstLeg.push({
        tour: round,
        home: rotation[index],
        away: rotation[7 - index],
      });
    }
    rotation = [rotation[0], rotation[7], ...rotation.slice(1, 7)];
  }
  const secondLeg = firstLeg.map(fixture => ({
    tour: fixture.tour + 7,
    home: fixture.away,
    away: fixture.home,
  }));
  return [...firstLeg, ...secondLeg].map((fixture, index) => {
    const homeWins = fixture.home.rank < fixture.away.rank;
    return {
      matchId: `S1_D${level}_G${group}_M${String(index + 1).padStart(2, '0')}`,
      season: 1,
      version: 140,
      leagueId: 'ALPHA',
      type: 'league',
      level,
      groupId: group,
      tour: fixture.tour,
      homeRank: fixture.home.rank,
      awayRank: fixture.away.rank,
      homeId: fixture.home.id,
      homeName: fixture.home.name,
      awayId: fixture.away.id,
      awayName: fixture.away.name,
      scoreA: homeWins ? 2 : 0,
      scoreB: homeWins ? 0 : 2,
      status: 'finished',
      isFinished: true,
      resolvedAt: new Date(Date.UTC(2026, 10, fixture.tour, 12, 0, 0)),
    };
  });
}

test('Firestore Emulator completes the 840-match Season 1 rollover, settles awards once, and activates Season 2 atomically', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');

  const app = initializeApp({ projectId }, `full-season-lifecycle-${randomUUID()}`);
  const firestore = getFirestore(app);
  const namespace = `seasonLifecycleFull_${randomUUID().replaceAll('-', '')}`;
  const db = {
    collection: name => firestore.collection(`${namespace}_${name}`),
    runTransaction: callback => firestore.runTransaction(callback),
  };
  const configRef = db.collection('system_v1').doc('season_config');
  const planRef = db.collection('league_season_rollovers_v1').doc('S2');
  const archiveRef = db.collection('league_season_archives_v1').doc('S1');
  const humanId = 'HUMAN_SEASON_LIFECYCLE';
  const humanProfileRef = db.collection('players_v14').doc(humanId);
  const humanSlotRef = db.collection('league_slots_v1').doc('S1_LALPHA_D1_G1_R1');
  const awardLedgerRef = db.collection('economy_transactions').doc('season_1_HUMAN_SEASON_LIFECYCLE');

  t.after(async () => {
    const archiveMatches = await archiveRef.collection('matches').get().catch(() => null);
    if (archiveMatches) {
      for (let offset = 0; offset < archiveMatches.docs.length; offset += 400) {
        const batch = firestore.batch();
        archiveMatches.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
        await batch.commit().catch(() => undefined);
      }
    }
    const collections = await firestore.listCollections();
    for (const collection of collections.filter(item => item.id.startsWith(namespace + '_'))) {
      const snapshot = await collection.get().catch(() => null);
      if (!snapshot) continue;
      for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
        const batch = firestore.batch();
        snapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
        await batch.commit().catch(() => undefined);
      }
    }
    await deleteApp(app);
  });

  const seasonStartMs = Date.now() - 18 * DAY_MS;
  const activationAtMs = seasonStartMs + 17 * DAY_MS;
  const nextSeasonStartMs = activationAtMs + 15 * DAY_MS;
  const seasonStart = new Date(seasonStartMs).toISOString();
  const activationAt = new Date(activationAtMs).toISOString();
  await configRef.set({
    activeSeasonNumber: 1,
    nextSeasonNumber: 2,
    preparationTargetSeason: 2,
    phase: 'REGULAR_SEASON',
    worldReady: true,
    worldGeneration: 'CLEAN_S1_V1',
    seasonStart,
    nextSeasonStart: activationAt,
    calendarRevision: 4,
    historyCleanupPending: false,
  });
  await db.collection('cup_pyramid_v1').doc('cup_s1_lALPHA').set({ winnerId: humanId, status: 'completed' });
  await humanProfileRef.set({
    id: humanId,
    uid: humanId,
    clubName: 'Season Lifecycle Human Club',
    displayName: 'Season Lifecycle Human Club',
    credits: 1_000_000,
    trophies: [],
    seasonAwards: {},
  });

  const tableWrites = [];
  const slotWrites = [];
  const matchWrites = [];
  let totalFixtures = 0;
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const fixtures = buildRoundRobinFixtures(level, group);
      assert.equal(fixtures.length, 56);
      assert.deepEqual([...new Set(fixtures.map(item => item.tour))].sort((a, b) => a - b),
        Array.from({ length: 14 }, (_, index) => index + 1));
      totalFixtures += fixtures.length;
      const computed = calculateGroupStandings({}, fixtures);
      assert.equal(computed.length, 8);
      const stats = Object.fromEntries(computed.map(row => [row.id, {
        ...row,
        isBot: row.id.startsWith('BOT_'),
      }]));
      tableWrites.push({
        ref: db.collection('league_tables_v2').doc(`table_v140_S1_LALPHA_D${level}_G${group}`),
        data: {
          id: `table_v140_S1_LALPHA_D${level}_G${group}`,
          leagueId: 'ALPHA',
          level,
          group,
          season: 1,
          version: 140,
          stats,
        },
      });
      for (let rank = 1; rank <= 8; rank++) {
        const team = fixtures.find(item => item.homeRank === rank)?.homeId ||
          fixtures.find(item => item.awayRank === rank)?.awayId;
        const isHuman = team === humanId;
        slotWrites.push({
          ref: db.collection('league_slots_v1').doc(`S1_LALPHA_D${level}_G${group}_R${rank}`),
          data: {
            season: 1,
            leagueId: 'ALPHA',
            division: level,
            group,
            rank,
            status: isHuman ? 'OCCUPIED' : 'FREE',
            occupantId: isHuman ? humanId : null,
            occupancyGeneration: isHuman ? 11 : 0,
          },
        });
      }
      for (const fixture of fixtures) {
        matchWrites.push({
          ref: db.collection('matches_v2').doc(fixture.matchId),
          data: fixture,
        });
      }
    }
  }
  assert.equal(totalFixtures, 840);

  const writes = [...tableWrites, ...slotWrites, ...matchWrites];
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = firestore.batch();
    writes.slice(offset, offset + 400).forEach(write => batch.set(write.ref, write.data));
    await batch.commit();
  }

  const rollover = await prepareSeasonRollover(db, 1, 2);
  assert.equal(rollover.ready, true, JSON.stringify(rollover));
  assert.equal(rollover.completed, true);
  assert.equal(rollover.expectedMatches, 840);
  assert.equal(rollover.groupCount, 15);
  assert.equal(rollover.observedMatches, 840);
  assert.equal(rollover.awards?.ready, true);
  assert.equal(rollover.awards?.rewardedClubs, 1);
  assert.equal(rollover.awards?.totalCredits, 4_000_000);

  const [archiveSnap, archiveMatchesSnap, planSnap, rewardedProfileSnap, ledgerSnap] = await Promise.all([
    archiveRef.get(),
    archiveRef.collection('matches').get(),
    planRef.get(),
    humanProfileRef.get(),
    awardLedgerRef.get(),
  ]);
  assert.equal(archiveSnap.get('status'), 'completed');
  assert.equal(archiveSnap.get('expectedMatches'), 840);
  assert.equal(archiveSnap.get('finishedMatches'), 840);
  assert.equal(archiveSnap.get('groups'), 15);
  assert.equal(archiveSnap.get('teamCount'), 120);
  assert.equal(archiveMatchesSnap.size, 840);
  assert.equal(planSnap.get('ready'), true);
  assert.equal(Object.keys(planSnap.get('groups')).length, 15);
  assert.equal(validateRolloverPlan(planSnap.data(), 1, 2).valid, true);
  assert.equal(isRolloverPlanPublicationReady(planSnap.data()), true);
  assert.equal(ledgerSnap.get('amount'), 4_000_000);
  assert.equal(rewardedProfileSnap.get('credits'), 5_000_000);
  assert.equal(rewardedProfileSnap.get('seasonAwards.S1.rank'), 1);
  assert.deepEqual(
    rewardedProfileSnap.get('trophies').map(trophy => trophy.id).sort(),
    ['league-cup-season-1', 'pyramid-cup-season-1'],
  );

  // Simulate the already-prepared Season 2 publication boundary. The test
  // exercises the real atomic activation transaction; calendar generation is
  // independently covered by the prepared-season Emulator scenarios.
  await configRef.update({
    phase: 'PUBLISHED',
    preparedSeasonNumber: 2,
    preparedWorldReady: true,
    preparedPublished: true,
    preparedCalendarRevision: 5,
    preparedSeasonStart: activationAt,
    preparedNextSeasonStart: new Date(nextSeasonStartMs).toISOString(),
    preparedRecoveryMode: false,
  });
  const activationExpected = {
    sourceSeason: 1,
    targetSeason: 2,
    calendarRevision: 5,
    activationAtMs,
    nextSeasonStartMs,
    multiSeasonRecovery: false,
    recoveryMode: false,
    nowMs: activationAtMs + 1_000,
    isPlanReady: plan => plan?.ready === true &&
      validateRolloverPlan(plan, 1, 2).valid &&
      isRolloverPlanPublicationReady(plan),
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
  const activation = await commitSeasonActivation(db, configRef, planRef, activationExpected);
  assert.deepEqual(activation, { success: true });
  const repeatedActivation = await commitSeasonActivation(db, configRef, planRef, activationExpected);
  assert.deepEqual(repeatedActivation, { success: false, reason: 'ACTIVATION_STATE_CHANGED' });

  const [activatedConfig, preservedProfile, preservedSlot, preservedSourceFixture] = await Promise.all([
    configRef.get(),
    humanProfileRef.get(),
    humanSlotRef.get(),
    db.collection('matches_v2').doc('S1_D1_G1_M01').get(),
  ]);
  assert.equal(activatedConfig.get('activeSeasonNumber'), 2);
  assert.equal(activatedConfig.get('historyCleanupPending'), true);
  assert.equal(preservedProfile.get('uid'), humanId);
  assert.equal(preservedProfile.get('credits'), 5_000_000);
  assert.equal(preservedProfile.get('trophies').length, 2);
  assert.equal(preservedSlot.get('occupantId'), humanId);
  assert.equal(preservedSlot.get('occupancyGeneration'), 11);
  assert.equal(preservedSourceFixture.get('isFinished'), true);
  assert.equal((await awardLedgerRef.get()).get('amount'), 4_000_000);
});
