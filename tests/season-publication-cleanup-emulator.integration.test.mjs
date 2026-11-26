import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  acquireSeasonCalendarBuildLock,
  commitSeasonCalendarPublication,
  commitSeasonHistoryCleanupWrites,
  releaseSeasonCalendarBuildLock,
  SEASON_CALENDAR_BUILD_LOCK_ID,
} from '../src/app/actions/season-rollover-lock.ts';
import { completeSeasonHistoryCleanup } from '../src/app/actions/season-history-cleanup.ts';
import { buildRecoveredSeasonArchiveSnapshot, resolveArchivePrunePlan } from '../src/app/actions/season-archive.ts';
import { buildPromotionRelegationGroups } from '../src/app/actions/season-rollover-plan.ts';
import { calculateGroupStandings } from '../src/app/actions/season-rollover-standings.ts';
import { pruneSeasonHistoryAfterActivation } from '../src/app/actions/season-history-prune.ts';

import { expectedRolloverGroups } from '../src/app/actions/season-rollover-plan.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

// Map every production collection lookup to a disposable test collection.
// In particular, system_v1/season_config and the shared calendar lock are
// NEVER read or written by these tests.
function isolatedDb(firestore, collectionName) {
  return {
    collection: name => firestore.collection(collectionName + '_' + name),
    runTransaction: fn => firestore.runTransaction(fn),
  };
}

async function withIsolatedFirestore(t) {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');
  const app = initializeApp({ projectId }, `season-publication-test-${randomUUID()}`);
  const firestore = getFirestore(app);
  const collectionName = `seasonLifecycleIntegrationTests_${randomUUID().replaceAll('-', '')}`;
  const db = isolatedDb(firestore, collectionName);
  const refs = new Set();
  const track = ref => { refs.add(ref); return ref; };
  const doc = id => track(db.collection('system_v1').doc(id));
  t.after(async () => {
    const tracked = [...refs];
    for (let offset = 0; offset < tracked.length; offset += 400) {
      const batch = firestore.batch();
      for (const ref of tracked.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit().catch(() => undefined);
    }
    await deleteApp(app);
  });
  return { db, doc, track, firestore, collectionName };
}

test('Firestore Emulator publication is fenced and cannot publish twice', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  const planRef = doc('S2');
  doc(SEASON_CALENDAR_BUILD_LOCK_ID);

  await configRef.set({
    activeSeasonNumber: 1,
    nextSeasonNumber: 2,
    preparationTargetSeason: 2,
    worldReady: true,
    preparedWorldReady: true,
    preparedSeasonNumber: 2,
    preparedCalendarRevision: 4,
    phase: 'GENERATING_NEXT',
  });
  await planRef.set({ ready: true, sourceSeason: 1, targetSeason: 2 });

  const lease = await acquireSeasonCalendarBuildLock(db, 1, 2);
  assert.equal(lease.acquired, true);
  const expected = {
    sourceSeason: 1,
    targetSeason: 2,
    calendarRevision: 4,
    phase: 'GENERATING_NEXT',
    planRef,
    validatePlan: plan => plan.ready === true && plan.sourceSeason === 1 && plan.targetSeason === 2,
    publicationDeadlineMs: Date.now() + 60_000,
    activationAtMs: Date.now() + 120_000,
  };
  const publication = {
    ref: configRef,
    data: { preparedPublished: true, phase: 'PUBLISHED' },
    options: { merge: true },
  };
  try {
    const first = await commitSeasonCalendarPublication(db, lease.ownerId, lease.token, expected, publication);
    assert.equal(first.committed, true);
    assert.equal((await configRef.get()).get('activeSeasonNumber'), 1);
    assert.equal((await configRef.get()).get('preparedPublished'), true);

    await assert.rejects(
      () => commitSeasonCalendarPublication(db, lease.ownerId, lease.token, expected, publication),
      /SEASON_CALENDAR_PUBLICATION_STATE_CHANGED/,
    );
    assert.equal((await configRef.get()).get('phase'), 'PUBLISHED');

    await planRef.update({ ready: false });
    await assert.rejects(
      () => commitSeasonCalendarPublication(
        db, lease.ownerId, lease.token,
        { ...expected, phase: 'PUBLISHED' }, publication,
      ),
      /SEASON_CALENDAR_PUBLICATION_PLAN_CHANGED/,
    );
    assert.equal((await configRef.get()).get('preparedPublished'), true);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lease.ownerId, lease.token);
  }
});

test('Firestore Emulator history cleanup rejects stale workers and changed active season', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  const oldArchiveRef = doc('old-archive');
  const lockRef = doc(SEASON_CALENDAR_BUILD_LOCK_ID);
  await configRef.set({
    activeSeasonNumber: 2,
    worldReady: true,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 2,
  });
  await oldArchiveRef.set({ seasonNumber: 0, disposable: true });
  const lease = await acquireSeasonCalendarBuildLock(db, 1, 2);
  assert.equal(lease.acquired, true);
  try {
    await assert.rejects(
      () => commitSeasonHistoryCleanupWrites(db, lease.ownerId, 'stale-token', 2, [], [oldArchiveRef]),
      /SEASON_CALENDAR_BUILD_LOCK_LOST/,
    );
    assert.equal((await oldArchiveRef.get()).exists, true);

    await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 2, [], [oldArchiveRef]);
    assert.equal((await oldArchiveRef.get()).exists, false);

    await configRef.update({ activeSeasonNumber: 3 });
    await assert.rejects(
      () => commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 2,
        [{ ref: oldArchiveRef, data: { recreated: true } }]),
      /SEASON_HISTORY_CLEANUP_TARGET_CHANGED/,
    );
    assert.equal((await oldArchiveRef.get()).exists, false);

    await configRef.update({ activeSeasonNumber: 2, historyCleanupPending: false });
    await assert.rejects(
      () => commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 2,
        [{ ref: oldArchiveRef, data: { recreated: true } }]),
      /SEASON_HISTORY_CLEANUP_TARGET_CHANGED/,
    );
    assert.equal((await oldArchiveRef.get()).exists, false);
    assert.equal((await lockRef.get()).exists, true);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lease.ownerId, lease.token);
  }
});


test('Firestore Emulator clears the cleanup marker only for the active target and only once', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  await configRef.set({
    activeSeasonNumber: 3,
    worldReady: true,
    historyCleanupPending: true,
    historyCleanupTargetSeason: 2,
  });

  const wrongTarget = await completeSeasonHistoryCleanup(db, 2);
  assert.deepEqual(wrongTarget, {
    ready: false,
    reason: 'HISTORY_CLEANUP_TARGET_CHANGED',
    shouldMarkComplete: false,
  });
  assert.equal((await configRef.get()).get('historyCleanupPending'), true);
  assert.equal((await configRef.get()).get('historyCleanupCompletedAt'), undefined);

  await configRef.update({ activeSeasonNumber: 2 });
  const concurrent = await Promise.all([
    completeSeasonHistoryCleanup(db, 2),
    completeSeasonHistoryCleanup(db, 2),
  ]);
  assert.equal(concurrent.every(result => result.ready), true);
  assert.equal(concurrent.filter(result => result.shouldMarkComplete).length, 1);

  const completed = await configRef.get();
  assert.equal(completed.get('activeSeasonNumber'), 2);
  assert.equal(completed.get('worldReady'), true);
  assert.equal(completed.get('historyCleanupPending'), false);
  assert.ok(completed.get('historyCleanupCompletedAt'));

  const retry = await completeSeasonHistoryCleanup(db, 2);
  assert.deepEqual(retry, {
    ready: true,
    reason: null,
    shouldMarkComplete: false,
  });
  assert.equal((await configRef.get()).get('historyCleanupPending'), false);
});


test('Firestore Emulator rolling archive deletion preserves durable player awards and trophies', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc, firestore, collectionName } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  const archiveRef = firestore.collection(`${collectionName}_archives`).doc('S1');
  const archivedMatchRef = archiveRef.collection('matches').doc('legacy-match');
  const historyRef = firestore.collection(`${collectionName}_history`).doc('S1');
  const lifetimeProfileRef = firestore.collection(`${collectionName}_players`).doc('human-club');

  const startingParticipants = Object.fromEntries(
    Array.from({ length: 4 }, (_, levelIndex) => {
      const level = levelIndex + 1;
      return Array.from({ length: 2 ** levelIndex }, (_, groupIndex) => {
        const group = `D${level}-G${groupIndex + 1}`;
        return [group, Array.from({ length: 8 }, (_, rankIndex) => ({
          id: `${group}-CLUB-${rankIndex + 1}`,
          rank: rankIndex + 1,
        }))];
      });
    }).flat(),
  );
  const recoveredArchive = {
    sourceSeason: 1,
    leagueId: 'ALPHA',
    archiveVersion: 1,
    status: 'recovered',
    recoveredAt: '2026-11-01T00:00:00.000Z',
    expectedMatches: 840,
    finishedMatches: 0,
    unresolvedMatches: 840,
    groups: 15,
    teamCount: 120,
    standings: {},
    startingParticipants,
    recovery: {
      status: 'incomplete',
      finalStandingsAvailable: false,
      reason: 'SEASON_INCOMPLETE',
    },
  };

  await Promise.all([
    configRef.set({
      activeSeasonNumber: 3,
      worldReady: true,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 3,
    }),
    archiveRef.set(recoveredArchive),
    archivedMatchRef.set({ matchId: 'legacy-match', season: 1, score: { home: 2, away: 1 } }),
    historyRef.set({ status: 'SKIPPED', targetSeason: 3 }),
    lifetimeProfileRef.set({
      credits: 98765,
      seasonAwards: { S1: { season: 1, rank: 1, prize: 5000 } },
      trophies: [{ id: 'league-cup-season-1', season: 1, type: 'league_champion' }],
      career: { matchesPlayed: 140, wins: 91 },
      achievements: ['first-title', 'season-one-champion'],
    }),
  ]);
  t.after(async () => {
    await Promise.all([
      archivedMatchRef.delete().catch(() => undefined),
      archiveRef.delete().catch(() => undefined),
      historyRef.delete().catch(() => undefined),
      lifetimeProfileRef.delete().catch(() => undefined),
    ]);
  });

  const archiveData = (await archiveRef.get()).data();
  const cleanupPlan = resolveArchivePrunePlan([{
    id: 'S1',
    archive: archiveData,
    matches: [],
    historyStatus: (await historyRef.get()).get('status'),
  }], 3, null);
  assert.equal(cleanupPlan.ready, true);
  assert.deepEqual(cleanupPlan.pruneIds, ['S1']);

  const lease = await acquireSeasonCalendarBuildLock(db, 2, 3);
  assert.equal(lease.acquired, true);
  try {
    await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 3, [{
      ref: archiveRef,
      data: {
        pruneStatus: 'PRUNING',
        pruneTargetSeason: 3,
        pruneRetainedArchiveSeason: 0,
        prunePolicyVersion: 1,
      },
      options: { merge: true },
    }]);
    await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 3, [], [archivedMatchRef]);
    await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 3, [], [archiveRef]);

    assert.equal((await archivedMatchRef.get()).exists, false);
    assert.equal((await archiveRef.get()).exists, false);
    assert.equal((await historyRef.get()).get('status'), 'SKIPPED');

    const lifetime = (await lifetimeProfileRef.get()).data();
    assert.equal(lifetime.credits, 98765);
    assert.deepEqual(lifetime.seasonAwards.S1, { season: 1, rank: 1, prize: 5000 });
    assert.deepEqual(lifetime.trophies, [{ id: 'league-cup-season-1', season: 1, type: 'league_champion' }]);
    assert.deepEqual(lifetime.career, { matchesPlayed: 140, wins: 91 });
    assert.deepEqual(lifetime.achievements, ['first-title', 'season-one-champion']);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lease.ownerId, lease.token);
  }
});


async function writeDocsInBatches(firestore, docs) {
  for (let offset = 0; offset < docs.length; offset += 400) {
    const batch = firestore.batch();
    for (const { ref, data } of docs.slice(offset, offset + 400)) batch.set(ref, data);
    await batch.commit();
  }
}

test('Firestore Emulator prunes S1-S4 after S6 activation, retains verified S5, and resumes interrupted deletion', {
  skip: !emulatorHost,
}, async t => {
  const { db, doc, firestore, collectionName } = await withIsolatedFirestore(t);
  const configRef = doc('season_config');
  const archiveCollection = firestore.collection(`${collectionName}_rolling_archives`);
  const historyCollection = firestore.collection(`${collectionName}_rolling_history`);
  const playersCollection = firestore.collection(`${collectionName}_rolling_players`);
  const lifetimeProfileRef = playersCollection.doc('human-club');
  const retained = makeCompletedArchive(5);
  const archiveRefs = new Map();
  const historyRefs = new Map();
  const matchRefs = new Map();
  const startingParticipants = Object.fromEntries(expectedRolloverGroups().map(group => [
    group,
    Array.from({ length: 8 }, (_, index) => ({
      id: `S1-${group}-CLUB-${index + 1}`,
      rank: index + 1,
    })),
  ]));

  const seedWrites = [];
  for (let season = 1; season <= 4; season++) {
    const archiveRef = archiveCollection.doc(`S${season}`);
    const historyRef = historyCollection.doc(`S${season}`);
    archiveRefs.set(season, archiveRef);
    historyRefs.set(season, historyRef);
    if (season === 4) {
      // S4 is a genuine completed archive with 840 persisted match snapshots.
      const completed = makeCompletedArchive(4);
      const refs = completed.matches.map(match => archiveRef.collection('matches').doc(match.matchId));
      matchRefs.set(season, refs);
      seedWrites.push({ ref: archiveRef, data: completed.archive });
      seedWrites.push(...completed.matches.map((match, index) => ({ ref: refs[index], data: match })));
    } else {
      const matchRef = archiveRef.collection('matches').doc(`legacy-S${season}`);
      matchRefs.set(season, [matchRef]);
      seedWrites.push({
        ref: archiveRef,
        data: {
          sourceSeason: season,
          leagueId: 'ALPHA',
          archiveVersion: 1,
          status: 'recovered',
          recoveredAt: '2026-11-01T00:00:00.000Z',
          expectedMatches: 840,
          finishedMatches: 0,
          unresolvedMatches: 840,
          groups: 15,
          teamCount: 120,
          standings: {},
          startingParticipants,
          recovery: { status: 'incomplete', finalStandingsAvailable: false, reason: 'SEASON_INCOMPLETE' },
        },
      }, {
        ref: historyRef,
        data: { status: 'SKIPPED', seasonNumber: season, targetSeason: 6 },
      }, {
        ref: matchRef,
        data: { matchId: `legacy-S${season}`, sourceSeason: season, score: { home: 2, away: 1 } },
      });
    }
  }

  const retainedRef = archiveCollection.doc('S5');
  archiveRefs.set(5, retainedRef);
  const retainedMatchRefs = retained.matches.map(match => retainedRef.collection('matches').doc(match.matchId));
  matchRefs.set(5, retainedMatchRefs);
  seedWrites.push({ ref: retainedRef, data: retained.archive });
  seedWrites.push(...retained.matches.map((match, index) => ({
    ref: retainedMatchRefs[index],
    data: match,
  })));
  seedWrites.push({
    ref: configRef,
    data: {
      activeSeasonNumber: 6,
      worldReady: true,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 6,
    },
  }, {
    ref: lifetimeProfileRef,
    data: {
      credits: 98765,
      seasonAwards: { S1: { season: 1, rank: 1, prize: 5000 }, S5: { season: 5, rank: 1, prize: 9000 } },
      trophies: [
        { id: 'league-cup-season-1', season: 1, type: 'league_champion' },
        { id: 'league-cup-season-5', season: 5, type: 'league_champion' },
      ],
      career: { matchesPlayed: 700, wins: 451 },
      achievements: ['first-title', 'season-five-champion'],
    },
  });

  await writeDocsInBatches(firestore, seedWrites);
  t.after(async () => {
    const cleanupRefs = [
      ...[...matchRefs.values()].flat(),
      ...[...archiveRefs.values()],
      ...[...historyRefs.values()],
      lifetimeProfileRef,
      configRef,
    ];
    for (let offset = 0; offset < cleanupRefs.length; offset += 400) {
      const batch = firestore.batch();
      for (const ref of cleanupRefs.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit().catch(() => undefined);
    }
  });

  const initialArchives = [];
  for (let season = 1; season <= 5; season++) {
    const archiveRef = archiveRefs.get(season);
    const archiveSnap = await archiveRef.get();
    const matchesSnap = await archiveRef.collection('matches').get();
    initialArchives.push({
      id: `S${season}`,
      archive: archiveSnap.data(),
      matches: matchesSnap.docs.map(snapshot => ({ ...snapshot.data(), matchId: snapshot.id })),
      historyStatus: season <= 3 ? 'SKIPPED' : '',
    });
  }
  const initialPlan = resolveArchivePrunePlan(initialArchives, 6, 5);
  assert.equal(initialPlan.ready, true, JSON.stringify(initialPlan));
  assert.deepEqual(initialPlan.pruneIds, ['S1', 'S2', 'S3', 'S4']);

  const lease = await acquireSeasonCalendarBuildLock(db, 5, 6);
  assert.equal(lease.acquired, true);
  try {
    for (const season of initialPlan.pruneIds.map(id => Number(id.slice(1)))) {
      await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 6, [{
        ref: archiveRefs.get(season),
        data: {
          pruneStatus: 'PRUNING',
          pruneTargetSeason: 6,
          pruneRetainedArchiveSeason: 5,
          prunePolicyVersion: 1,
        },
        options: { merge: true },
      }]);
    }

    // Simulate a crash after deleting S1/S2 and 400 of S4's 840 match snapshots.
    for (const season of [1, 2]) {
      await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 6, [], matchRefs.get(season));
      await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 6, [], [archiveRefs.get(season)]);
    }
    assert.equal((await archiveRefs.get(1).get()).exists, false);
    assert.equal((await archiveRefs.get(2).get()).exists, false);
    await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 6, [], matchRefs.get(4).slice(0, 400));
    assert.equal((await archiveRefs.get(4).get()).exists, true);
    assert.equal((await archiveRefs.get(4).collection('matches').get()).size, 440);

    // The retry must trust matching PRUNING intents, even after match deletion.
    const resumedArchives = [];
    for (const season of [3, 4, 5]) {
      const archiveRef = archiveRefs.get(season);
      const archiveSnap = await archiveRef.get();
      const matchesSnap = season === 5
        ? await archiveRef.collection('matches').get()
        : null;
      resumedArchives.push({
        id: `S${season}`,
        archive: archiveSnap.data(),
        matches: matchesSnap ? matchesSnap.docs.map(snapshot => ({ ...snapshot.data(), matchId: snapshot.id })) : [],
        historyStatus: season <= 3 ? 'SKIPPED' : '',
      });
    }
    const resumedPlan = resolveArchivePrunePlan(resumedArchives, 6, 5);
    assert.equal(resumedPlan.ready, true, JSON.stringify(resumedPlan));
    assert.deepEqual(resumedPlan.pruneIds, ['S3', 'S4']);

    for (const season of resumedPlan.pruneIds.map(id => Number(id.slice(1)))) {
      const matchesSnap = await archiveRefs.get(season).collection('matches').get();
      const refs = matchesSnap.docs.map(snapshot => snapshot.ref);
      for (let offset = 0; offset < refs.length; offset += 400) {
        await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 6, [], refs.slice(offset, offset + 400));
      }
      await commitSeasonHistoryCleanupWrites(db, lease.ownerId, lease.token, 6, [], [archiveRefs.get(season)]);
    }

    const postflightMatches = await retainedRef.collection('matches').get();
    const postflight = resolveArchivePrunePlan([{
      id: 'S5',
      archive: (await retainedRef.get()).data(),
      matches: postflightMatches.docs.map(snapshot => ({ ...snapshot.data(), matchId: snapshot.id })),
      historyStatus: '',
    }], 6, 5);
    assert.equal(postflight.ready, true, JSON.stringify(postflight));
    assert.deepEqual(postflight.pruneIds, []);
    assert.equal(postflightMatches.size, 840);
    for (const season of [1, 2, 3, 4]) {
      assert.equal((await archiveRefs.get(season).get()).exists, false, `S${season} archive should be pruned`);
    }
    for (const season of [1, 2, 3]) {
      assert.equal((await historyRefs.get(season).get()).get('status'), 'SKIPPED');
    }
    assert.equal((await retainedRef.get()).exists, true);
    const lifetime = (await lifetimeProfileRef.get()).data();
    assert.equal(lifetime.credits, 98765);
    assert.deepEqual(lifetime.seasonAwards.S1, { season: 1, rank: 1, prize: 5000 });
    assert.deepEqual(lifetime.seasonAwards.S5, { season: 5, rank: 1, prize: 9000 });
    assert.equal(lifetime.trophies.length, 2);
    assert.deepEqual(lifetime.career, { matchesPlayed: 700, wins: 451 });
    assert.deepEqual(lifetime.achievements, ['first-title', 'season-five-champion']);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lease.ownerId, lease.token);
  }
});


function expectedGroupKeys() {
  const groups = [];
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) groups.push('D' + level + '-G' + group);
  }
  return groups;
}

function makeStartingParticipants(season) {
  return Object.fromEntries(expectedGroupKeys().map(group => [
    group,
    Array.from({ length: 8 }, (_, index) => ({
      id: 'S' + season + '-' + group + '-CLUB-' + (index + 1),
      rank: index + 1,
    })),
  ]));
}

function makeCompletedArchive(sourceSeason) {
  const matches = [];
  const standings = {};
  for (const groupKey of expectedGroupKeys()) {
    const [, level, group] = /^D([1-4])-G(\d+)$/.exec(groupKey);
    const fixtures = [];
    for (let homeRank = 1; homeRank <= 8; homeRank++) {
      for (let awayRank = 1; awayRank <= 8; awayRank++) {
        if (homeRank === awayRank) continue;
        const draw = (homeRank + awayRank) % 5 === 0;
        const homeScore = draw ? 1 : homeRank < awayRank ? 2 : 0;
        const awayScore = draw ? 1 : homeRank < awayRank ? 0 : 2;
        const fixture = {
          matchId: groupKey + '-T' + (Math.floor(fixtures.length / 4) + 1) + '-' + homeRank + '-' + awayRank,
          version: 140,
          sourceSeason,
          level: Number(level),
          group: Number(group),
          tour: Math.floor(fixtures.length / 4) + 1,
          homeRank,
          awayRank,
          homeId: groupKey + '-CLUB-' + homeRank,
          awayId: groupKey + '-CLUB-' + awayRank,
          homeName: groupKey + '-CLUB-' + homeRank,
          awayName: groupKey + '-CLUB-' + awayRank,
          score: { home: homeScore, away: awayScore },
          status: 'finished',
          isFinished: true,
        };
        fixtures.push(fixture);
        matches.push(fixture);
      }
    }
    standings[groupKey] = calculateGroupStandings({}, fixtures).map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
  }
  const placement = buildPromotionRelegationGroups(standings);
  assert.equal(placement.ready, true);
  const completedAt = '2026-11-05T15:00:00.000Z';
  return {
    archive: {
      sourceSeason,
      leagueId: 'ALPHA',
      archiveVersion: 1,
      status: 'completed',
      completedAt,
      finalizedAt: completedAt,
      expectedMatches: 840,
      finishedMatches: 840,
      groups: 15,
      teamCount: 120,
      integrity: {
        complete: true,
        unfinishedMatches: 0,
        invalidResults: 0,
        canonicalMatches: 840,
        duplicateCanonicalFixtures: 0,
      },
      standings,
    },
    matches,
    groups: placement.groups,
  };
}

function makeRolloverPlan(sourceSeason, targetSeason, groups, skippedSeasons = []) {
  return {
    sourceSeason,
    targetSeason,
    ready: true,
    awards: { ready: true },
    groups,
    skippedSeasons,
  };
}

function failOnceOnArchiveMatchDelete(db, firestore, physicalArchiveCollection, archiveId, failAfterDeletes = 0) {
  let interrupted = false;
  let deletedMatches = 0;
  const wrappedDb = {
    collection: name => db.collection(name),
    runTransaction: (callback, options) => firestore.runTransaction(tx => callback({
      get: (...args) => tx.get(...args),
      set: (...args) => tx.set(...args),
      update: (...args) => tx.update(...args),
      delete: ref => {
        const failedPath = physicalArchiveCollection + '/' + archiveId + '/matches/';
        if (ref.path.startsWith(failedPath)) {
          if (!interrupted && deletedMatches >= failAfterDeletes) {
            interrupted = true;
            throw new Error('SIMULATED_SEASON_HISTORY_CLEANUP_INTERRUPTION');
          }
          deletedMatches++;
        }
        return tx.delete(ref);
      },
    }), options),
  };
  return { db: wrappedDb, wasInterrupted: () => interrupted };
}

test('Firestore Emulator prunes S1-S4 after S6 activation, retains S5 and resumes interrupted cleanup', {
  skip: !emulatorHost,
}, async t => {
  const { db, track, firestore, collectionName } = await withIsolatedFirestore(t);
  const configRef = track(db.collection('system_v1').doc('season_config'));
  const lockRef = track(db.collection('system_v1').doc(SEASON_CALENDAR_BUILD_LOCK_ID));
  const skippedSeasons = [1, 2, 3].map(seasonNumber => ({
    seasonNumber,
    reason: 'SEASON_INCOMPLETE',
  }));

  const archiveRefs = new Map();
  for (const seasonNumber of [1, 2, 3]) {
    const recovered = buildRecoveredSeasonArchiveSnapshot({
      sourceSeason: seasonNumber,
      startingParticipants: makeStartingParticipants(seasonNumber),
      finishedMatches: 0,
      reason: 'SEASON_INCOMPLETE',
      recoveredAt: '2026-11-01T00:00:00.000Z',
    });
    assert.equal(recovered.ready, true);
    const archiveRef = track(db.collection('league_season_archives_v1').doc('S' + seasonNumber));
    const matchRef = track(archiveRef.collection('matches').doc('legacy-match-' + seasonNumber));
    archiveRefs.set(seasonNumber, archiveRef);
    await Promise.all([
      archiveRef.set(recovered.archive),
      matchRef.set({ season: seasonNumber, status: 'legacy_snapshot' }),
    ]);
  }

  // S4 is a completed archive, and the real cleanup worker must resume after
  // a committed first batch has already removed 400 of its 840 match snapshots.
  const completedS4 = makeCompletedArchive(4);
  const completedS4Ref = track(db.collection('league_season_archives_v1').doc('S4'));
  archiveRefs.set(4, completedS4Ref);
  await completedS4Ref.set(completedS4.archive);
  const completedS4Writes = completedS4.matches.map(match => {
    const { matchId, ...data } = match;
    const ref = track(completedS4Ref.collection('matches').doc(matchId));
    return { ref, data };
  });
  await writeDocsInBatches(firestore, completedS4Writes);

  const completed = makeCompletedArchive(5);
  const retainedArchiveRef = track(db.collection('league_season_archives_v1').doc('S5'));
  await retainedArchiveRef.set(completed.archive);
  for (let offset = 0; offset < completed.matches.length; offset += 400) {
    const batch = firestore.batch();
    for (const match of completed.matches.slice(offset, offset + 400)) {
      const { matchId, ...data } = match;
      const ref = track(retainedArchiveRef.collection('matches').doc(matchId));
      batch.set(ref, data);
    }
    await batch.commit();
  }

  const planRefs = new Map();
  for (let seasonNumber = 1; seasonNumber <= 6; seasonNumber++) {
    const ref = track(db.collection('league_season_rollovers_v1').doc('S' + seasonNumber));
    planRefs.set(seasonNumber, ref);
    await ref.set(makeRolloverPlan(
      seasonNumber - 1,
      seasonNumber,
      completed.groups,
      seasonNumber === 6 ? skippedSeasons : [],
    ));
  }
  const historyRefs = new Map();
  for (const { seasonNumber } of skippedSeasons) {
    historyRefs.set(seasonNumber, track(db.collection('league_season_history_v1').doc('S' + seasonNumber)));
  }

  const lifetimeProfile = {
    credits: 98765,
    seasonAwards: { S1: { season: 1, rank: 1, prize: 5000 } },
    trophies: [{ id: 'league-cup-season-1', season: 1, type: 'league_champion' }],
    career: { matchesPlayed: 140, wins: 91 },
    achievements: ['first-title', 'season-one-champion'],
  };
  const playerRef = track(db.collection('players_v14').doc('human-club'));
  const durableBackupRef = track(db.collection('staging_season_one_reset_archives_v1').doc('CLEAN_S1_V1'));
  await Promise.all([
    configRef.set({
      activeSeasonNumber: 6,
      worldReady: true,
      historyCleanupPending: true,
      historyCleanupTargetSeason: 6,
      lastRecoverySkippedSeasons: skippedSeasons,
    }),
    playerRef.set(lifetimeProfile),
    durableBackupRef.set({
      snapshotId: 'CLEAN_S1_V1',
      sourceSeason: 1,
      fullSnapshotRetained: true,
      participantCount: 120,
    }),
  ]);

  // A malformed retained snapshot must stop cleanup before any deletion
  // intent is written. Keep archive metadata valid so the retained snapshot
  // validator—not the archive identity gate—detects the bad match result.
  const corruptedRetainedMatchRef = retainedArchiveRef.collection('matches').doc(completed.matches[0].matchId);
  await corruptedRetainedMatchRef.update({ score: { home: 0, away: 0 } });
  await assert.rejects(
    () => pruneSeasonHistoryAfterActivation(db, 6, 5),
    /RETAINED_ARCHIVE_INVALID/,
  );
  for (const seasonNumber of [1, 2, 3, 4]) {
    assert.equal((await archiveRefs.get(seasonNumber).get()).exists, true);
    assert.equal((await archiveRefs.get(seasonNumber).get()).get('pruneStatus'), undefined);
    const retainedMatches = await archiveRefs.get(seasonNumber).collection('matches').get();
    assert.equal(retainedMatches.size, seasonNumber === 4 ? 840 : 1);
  }
  for (const seasonNumber of [1, 2, 3]) {
    assert.equal((await historyRefs.get(seasonNumber).get()).get('status'), 'SKIPPED');
  }
  assert.equal((await retainedArchiveRef.get()).exists, true);
  await corruptedRetainedMatchRef.update({ score: completed.matches[0].score });

  // Fail during S4 child deletion after S1-S3 were removed and the first 400
  // of S4's 840 completed-match snapshots were durably deleted.
  const interrupted = failOnceOnArchiveMatchDelete(
    db,
    firestore,
    collectionName + '_league_season_archives_v1',
    'S4',
    400,
  );
  await assert.rejects(
    () => pruneSeasonHistoryAfterActivation(interrupted.db, 6, 5),
    /SIMULATED_SEASON_HISTORY_CLEANUP_INTERRUPTION/,
  );
  assert.equal(interrupted.wasInterrupted(), true);
  for (const seasonNumber of [1, 2, 3]) {
    assert.equal((await archiveRefs.get(seasonNumber).get()).exists, false);
    assert.equal((await archiveRefs.get(seasonNumber).collection('matches').get()).size, 0);
  }
  assert.equal((await archiveRefs.get(4).get()).get('pruneStatus'), 'PRUNING');
  assert.equal((await archiveRefs.get(4).collection('matches').get()).size, 440);
  assert.equal((await retainedArchiveRef.get()).exists, true);
  assert.equal((await retainedArchiveRef.collection('matches').get()).size, 840);
  assert.equal((await planRefs.get(6).get()).exists, true);
  assert.equal((await planRefs.get(1).get()).exists, true);

  const resumed = await pruneSeasonHistoryAfterActivation(db, 6, 5);
  assert.deepEqual(resumed, {
    deletedArchives: 1,
    deletedArchiveMatches: 440,
    deletedRolloverPlans: 5,
    retainedArchiveSeason: 5,
  });

  for (const seasonNumber of [1, 2, 3, 4]) {
    assert.equal((await archiveRefs.get(seasonNumber).get()).exists, false);
    assert.equal((await archiveRefs.get(seasonNumber).collection('matches').get()).size, 0);
  }
  for (const seasonNumber of [1, 2, 3]) {
    assert.equal((await historyRefs.get(seasonNumber).get()).get('status'), 'SKIPPED');
  }
  assert.equal((await retainedArchiveRef.get()).exists, true);
  assert.equal((await retainedArchiveRef.collection('matches').get()).size, 840);
  for (const seasonNumber of [1, 2, 3, 4, 5]) {
    assert.equal((await planRefs.get(seasonNumber).get()).exists, false);
  }
  assert.equal((await planRefs.get(6).get()).exists, true);

  assert.deepEqual((await playerRef.get()).data(), lifetimeProfile);
  assert.deepEqual((await durableBackupRef.get()).data(), {
    snapshotId: 'CLEAN_S1_V1',
    sourceSeason: 1,
    fullSnapshotRetained: true,
    participantCount: 120,
  });

  const completion = await completeSeasonHistoryCleanup(db, 6);
  assert.deepEqual(completion, { ready: true, reason: null, shouldMarkComplete: true });
  assert.equal((await configRef.get()).get('historyCleanupPending'), false);
  assert.equal((await configRef.get()).get('historyCleanupTargetSeason'), 6);
  assert.equal((await lockRef.get()).exists, false);
});
