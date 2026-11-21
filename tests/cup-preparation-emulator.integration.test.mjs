import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps } from 'firebase-admin/app';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.GCLOUD_PROJECT = 'demo-forge-rivals-cup-test';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const EXPECTED_MATCHES = { 1: 56, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };

test('prepared Season 2 receives its complete Pyramid Cup before publication in an isolated Firestore Emulator project', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);

  const [{ getAdminDb }, { getTableId, MAX_LEVELS, TEAMS_PER_GROUP }, { MATCH_COLLECTIONS }, { preparePyramidCupForSeason, runPyramidCupCycle }, { resolveUniversalMatchDocument }] = await Promise.all([
    import('../src/lib/firebase-admin.ts'),
    import('../src/app/lib/leagues-data.ts'),
    import('../src/app/lib/match-storage.ts'),
    import('../src/app/actions/cup-engine.ts'),
    import('../src/app/actions/universal-match-resolver.ts'),
  ]);
  const db = getAdminDb();
  const season = 2;
  const humanUid = 'USER_CUP_TEST_S2_D4_G8_R8';
  const seasonStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expectedFirstKickoff = new Date(seasonStart.getTime() + 86400000);
  expectedFirstKickoff.setUTCHours(4, 0, 0, 0);
  const configRef = db.collection('system_v1').doc('season_config');
  const cupRef = db.collection('cup_pyramid_v1').doc(`cup_s${season}_lALPHA`);
  const tableRefs = [];
  const fixtureRefs = [];
  const playerRefs = [];
  const participantSnapshotRefs = [];
  const economyRefs = [
    db.collection('economy_transactions').doc(`pyramid_cup_S${season}_champion_${humanUid}`),
  ];

  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const tableRef = db.collection('league_tables_v2').doc(getTableId(season, 'ALPHA', level, group));
      tableRefs.push(tableRef);
    }
  }

  t.after(async () => {
    const batch = db.batch();
    [configRef, cupRef, ...tableRefs, ...fixtureRefs, ...playerRefs, ...participantSnapshotRefs, ...economyRefs].forEach(ref => batch.delete(ref));
    await batch.commit().catch(() => undefined);
    const app = getApps().find(candidate => candidate.name === '[DEFAULT]');
    if (app) await deleteApp(app).catch(() => undefined);
  });

  await configRef.set({
    activeSeasonNumber: 1,
    phase: 'GENERATING_NEXT',
    worldReady: true,
    preparedSeasonNumber: season,
    preparedWorldReady: true,
    preparedPublished: false,
    preparedSeasonStart: seasonStart.toISOString(),
    preparedNextSeasonStart: new Date(seasonStart.getTime() + 15 * 86400000).toISOString(),
  });

  const tableBatch = db.batch();
  const playerBatch = db.batch();
  let teamCount = 0;
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const stats = {};
      for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
        const id = level === 4 && group === 8 && rank === 8
          ? humanUid
          : `BOT_CUP_TEST_S${season}_D${level}_G${group}_R${rank}`;
        const name = `Test D${level} G${group} R${rank}`;
        stats[id] = { id, name, rank, isBot: id.startsWith('BOT_') };
        const playerRef = db.collection('players_v14').doc(id);
        playerRefs.push(playerRef);
        participantSnapshotRefs.push(db.collection('cup_participant_snapshots_v1').doc(cupRef.id).collection('teams').doc(id));
        const roles = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];
        playerBatch.set(playerRef, {
          id,
          isBot: id.startsWith('BOT_'),
          credits: 1_000_000,
          clubName: name,
          displayName: name,
          strategy: 'Balanced Play',
          ownedPlayers: roles.map((role, index) => ({
            id: `${id}_P${index + 1}`,
            name: `${name} ${role}`,
            role,
            currentRole: role,
            overallRating: 25,
            form: 100,
            fatigue: 100,
            tilt: 0,
            chemistryMatches: 30,
            proStats: {},
          })),
        });
        teamCount++;
      }
      tableBatch.set(db.collection('league_tables_v2').doc(getTableId(season, 'ALPHA', level, group)), {
        id: getTableId(season, 'ALPHA', level, group),
        leagueId: 'ALPHA',
        level,
        group,
        season,
        version: 140,
        stats,
      });
    }
  }
  await Promise.all([tableBatch.commit(), playerBatch.commit()]);
  assert.equal(teamCount, 120);

  const result = await preparePyramidCupForSeason(season);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.generated, true);
  assert.equal(result.participants, 120);
  assert.equal(result.preliminaryMatches, 56);
  assert.equal(result.byes, 8);
  assert.equal(result.scheduledAt, expectedFirstKickoff.toISOString(), 'preliminary cup round must follow league Tour 1 at 07:00 Moscow time');

  const cupSnap = await cupRef.get();
  assert.equal(cupSnap.exists, true);
  const cup = cupSnap.data();
  assert.equal(cup.status, 'active');
  assert.equal(cup.currentRound, 1);
  assert.equal(cup.participants.length, 120);
  assert.equal(cup.rounds.r1.length, 64);
  assert.equal(cup.rounds.r1[0].home.matchSnapshot, undefined, 'large roster snapshots must not inflate the bracket document');
  assert.equal(cup.rounds.r1.filter(pairing => pairing.status === 'bye').length, 8);

  const firstRound = cup.rounds.r1.filter(pairing => pairing.home && pairing.away);
  assert.equal(firstRound.length, 56);
  for (const pairing of firstRound) {
    const fixtureRef = db.collection(MATCH_COLLECTIONS.cup).doc(pairing.matchId);
    fixtureRefs.push(fixtureRef);
    const fixtureSnap = await fixtureRef.get();
    assert.equal(fixtureSnap.exists, true, `missing ${pairing.matchId}`);
    const fixture = fixtureSnap.data();
    assert.equal(fixture.cupId, cupRef.id);
    assert.equal(fixture.homeId, pairing.home.id);
    assert.equal(fixture.awayId, pairing.away.id);
    assert.equal(fixture.homeTeamSnapshot.players.length, 5);
    const homeParticipantSnapshot = await db.collection('cup_participant_snapshots_v1').doc(cupRef.id).collection('teams').doc(pairing.home.id).get();
    assert.equal(homeParticipantSnapshot.exists, true);
    assert.equal(homeParticipantSnapshot.data().matchSnapshot.players.length, 5);
    assert.equal(fixture.awayTeamSnapshot.players.length, 5);
    assert.equal(fixture.homeTeamSnapshot.name, pairing.home.name);
    assert.equal(fixture.scheduledAt.toMillis(), expectedFirstKickoff.getTime());
    assert.equal(fixture.scheduledAt.toDate().getUTCHours(), 4);
  }

  const retry = await preparePyramidCupForSeason(season);
  assert.equal(retry.success, true, JSON.stringify(retry));
  assert.equal(retry.alreadyExists, true);
  assert.equal((await cupRef.get()).data().rounds.r1.length, 64);

  // The participant roster is frozen at generation. Even if a replaced bot's
  // live profile is retired by registration, its published Cup fixture remains playable.
  const firstPairing = firstRound[0];
  assert.equal(firstPairing.home.id, humanUid, 'the weakest seed should be home against the strongest eligible seed');
  await db.collection('players_v14').doc(firstPairing.away.id).delete();
  const resolved = await resolveUniversalMatchDocument(firstPairing.matchId, { collectionName: MATCH_COLLECTIONS.cup });
  assert.equal(resolved.finished, true, JSON.stringify(resolved));
  const resolvedFixture = (await db.collection(MATCH_COLLECTIONS.cup).doc(firstPairing.matchId).get()).data();
  assert.ok([firstPairing.home.id, firstPairing.away.id].includes(resolvedFixture.winnerId));
  assert.equal(resolvedFixture.bestOf, 1);
  assert.equal(Number(resolvedFixture.scoreA) + Number(resolvedFixture.scoreB), 1);
  assert.equal(resolvedFixture.games.length, 1);
  // The next assertions isolate bracket progression from the random winner
  // produced by this single Match Core smoke test.
  await db.collection(MATCH_COLLECTIONS.cup).doc(firstPairing.matchId).update({
    winnerId: firstPairing.home.id,
    scoreA: 1,
    scoreB: 0,
    seriesScore: '1-0',
  });

  await configRef.set({
    activeSeasonNumber: season,
    phase: 'REGULAR_SEASON',
    worldReady: true,
    seasonStart: seasonStart.toISOString(),
    nextSeasonStart: new Date(seasonStart.getTime() + 15 * 86400000).toISOString(),
    preparedSeasonNumber: null,
    preparedWorldReady: false,
  }, { merge: true });

  // Drive every remaining bracket round through the real Cup worker. Fixtures
  // are marked with deterministic valid outcomes so this test exercises
  // winner collection, round creation, idempotent state transitions and finalization.
  for (let round = 1; round <= 6; round++) {
    const currentCup = (await cupRef.get()).data();
    assert.equal(currentCup.currentRound, round);
    const pairings = currentCup.rounds[`r${round}`];
    for (const pairing of pairings.filter(value => value.home && value.away)) {
      const fixtureRef = db.collection(MATCH_COLLECTIONS.cup).doc(pairing.matchId);
      const fixtureSnap = await fixtureRef.get();
      assert.equal(fixtureSnap.exists, true, `missing round ${round} fixture ${pairing.matchId}`);
      if (fixtureSnap.data().isFinished !== true) {
        await fixtureRef.update({
          status: 'finished',
          isFinished: true,
          isProcessing: false,
          winnerId: pairing.home.id,
          scoreA: round === 7 ? 2 : 1,
          scoreB: 0,
        });
      }
    }
    const advanced = await runPyramidCupCycle();
    assert.equal(advanced.advanced, 1, JSON.stringify({ round, advanced }));
    const nextCup = (await cupRef.get()).data();
    assert.equal(nextCup.currentRound, round + 1);
    const nextPairings = nextCup.rounds[`r${round + 1}`];
    assert.equal(nextPairings.filter(value => value.home && value.away).length, EXPECTED_MATCHES[round + 1]);
    for (const pairing of nextPairings.filter(value => value.home && value.away)) {
      const nextFixtureRef = db.collection(MATCH_COLLECTIONS.cup).doc(pairing.matchId);
      fixtureRefs.push(nextFixtureRef);
      const nextFixture = await nextFixtureRef.get();
      assert.equal(nextFixture.exists, true);
      assert.equal(nextFixture.data().homeTeamSnapshot.players.length, 5);
      assert.equal(nextFixture.data().awayTeamSnapshot.players.length, 5);
    }
  }

  const finalCup = (await cupRef.get()).data();
  assert.equal(finalCup.currentRound, 7);
  const finalPairing = finalCup.rounds.r7[0];
  const finalRef = db.collection(MATCH_COLLECTIONS.cup).doc(finalPairing.matchId);
  await finalRef.update({
    status: 'finished',
    isFinished: true,
    isProcessing: false,
    winnerId: finalPairing.home.id,
    scoreA: 2,
    scoreB: 0,
  });
  const completed = await runPyramidCupCycle();
  assert.equal(completed.completed, true, JSON.stringify(completed));
  const completedCup = (await cupRef.get()).data();
  assert.equal(completedCup.status, 'completed');
  assert.equal(completedCup.winnerId, finalPairing.home.id);
  assert.equal(completedCup.winnerId, humanUid);
  assert.equal(completedCup.winnerName, finalPairing.home.name);
  const championProfile = (await db.collection('players_v14').doc(humanUid).get()).data();
  assert.equal(championProfile.credits, 1_350_000);
  assert.ok(championProfile.trophies.some(trophy => trophy.id === `pyramid-cup-season-${season}`));
  const championLedger = (await economyRefs[0].get()).data();
  assert.equal(championLedger.amount, 350_000);
  assert.equal(championLedger.type, 'PYRAMID_CUP_CHAMPION_REWARD');
});
