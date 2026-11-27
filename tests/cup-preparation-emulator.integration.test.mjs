import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps } from 'firebase-admin/app';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.GCLOUD_PROJECT = 'demo-forge-rivals-cup-test';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const EXPECTED_MATCHES = { 1: 56, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
const EXPECTED_PAIRINGS = { 1: 56, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };

test('prepared Season 2 receives its complete Pyramid Cup before publication in an isolated Firestore Emulator project', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);

  const [{ getAdminDb }, { getTableId, MAX_LEVELS, TEAMS_PER_GROUP }, { MATCH_COLLECTIONS }, { generatePyramidCup, preparePyramidCupForSeason, runPyramidCupCycle }, { resolveUniversalMatchDocument }] = await Promise.all([
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

  // A stale/corrupted prepared-season projection must not let Cup preparation
  // jump from active Season 1 directly to Season 3.
  await configRef.update({ preparedSeasonNumber: 3 });
  const skippedSeasonCup = await preparePyramidCupForSeason(3);
  assert.deepEqual(skippedSeasonCup, {
    success: false,
    reason: 'PREPARED_SEASON_NOT_READY',
    writesStarted: false,
  });
  assert.equal((await db.collection('cup_pyramid_v1').doc('cup_s3_lALPHA').get()).exists, false);
  await configRef.update({ preparedSeasonNumber: season });

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

  // The initial preflight can complete before a reset claims the world. The
  // final creation transaction must re-read the marker and publish nothing.
  await configRef.set({ stagingSeasonOneResetInProgress: true }, { merge: true });
  await assert.rejects(
    () => generatePyramidCup(season),
    /STAGING_SEASON_ONE_RESET_IN_PROGRESS/,
  );
  const [cupDuringReset, snapshotsDuringReset, fixturesDuringReset] = await Promise.all([
    cupRef.get(),
    db.collection('cup_participant_snapshots_v1').doc(cupRef.id).collection('teams').get(),
    db.collection(MATCH_COLLECTIONS.cup).where('cupId', '==', cupRef.id).get(),
  ]);
  assert.equal(cupDuringReset.exists, false);
  assert.equal(snapshotsDuringReset.size, 0);
  assert.equal(fixturesDuringReset.size, 0);
  await configRef.set({ stagingSeasonOneResetInProgress: false }, { merge: true });

  // Capture every one of the 15 official league tables. Cup progression,
  // match resolution and champion rewards must never mutate league standings.
  const leagueTablesBeforeCup = await Promise.all(tableRefs.map(async ref => {
    const snap = await ref.get();
    assert.equal(snap.exists, true);
    return JSON.stringify(snap.data());
  }));

  // Two scheduler invocations can both pass the initial missing-Cup read.
  // They must converge on the same complete bracket: one creates it and the
  // other observes the winning atomic batch as an idempotent retry.
  const [result, concurrentResult] = await Promise.all([
    preparePyramidCupForSeason(season),
    preparePyramidCupForSeason(season),
  ]);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(concurrentResult.success, true, JSON.stringify(concurrentResult));
  assert.equal([result, concurrentResult].filter(value => value.generated).length, 1,
    JSON.stringify({ result, concurrentResult }));
  assert.equal([result, concurrentResult].filter(value => value.alreadyExists).length, 1,
    JSON.stringify({ result, concurrentResult }));
  assert.equal(result.participants, 120);
  assert.equal(result.preliminaryMatches, 56);
  assert.equal(result.totalMatches, 119);
  assert.equal(result.openingRoundRestCount, 8);
  assert.equal(result.byes, 0);
  assert.equal(result.scheduledAt, expectedFirstKickoff.toISOString(), 'preliminary cup round must follow league Tour 1 at 07:00 Moscow time');

  // Preparing the next season's Cup must not publish or activate that season.
  const configAfterCupPreparation = (await configRef.get()).data();
  assert.equal(configAfterCupPreparation.activeSeasonNumber, 1);
  assert.equal(configAfterCupPreparation.preparedSeasonNumber, season);
  assert.equal(configAfterCupPreparation.preparedWorldReady, true);
  assert.equal(configAfterCupPreparation.preparedPublished, false);
  assert.equal(configAfterCupPreparation.phase, 'GENERATING_NEXT');

  const cupSnap = await cupRef.get();
  assert.equal(cupSnap.exists, true);
  const cup = cupSnap.data();
  assert.equal(cup.status, 'active');
  assert.equal(cup.currentRound, 1);
  assert.equal(cup.participants.length, 120);
  assert.equal(cup.preliminaryMatches, 56);
  assert.equal(cup.byeCount, 0);
  assert.equal(cup.formatVersion, 4);
  assert.equal(cup.format, 'D1_REST_OPENING_ROUND');
  assert.equal(cup.totalMatches, 119);
  assert.equal(cup.openingRoundRestCount, 8);
  assert.equal(cup.rounds.r1.length, 56);
  assert.equal(cup.rounds.r1[0].home.matchSnapshot, undefined, 'large roster snapshots must not inflate the bracket document');
  assert.equal(cup.rounds.r1.filter(pairing => pairing.status === 'bye').length, 0);

  const firstRound = cup.rounds.r1.filter(pairing => pairing.home && pairing.away);
  assert.equal(firstRound.length, 56);
  const openingIds = new Set(firstRound.flatMap(pairing => [pairing.home.id, pairing.away.id]));
  const restedIds = new Set(cup.openingRoundRestTeams.map(team => team.id));
  assert.equal(openingIds.size, 112);
  assert.equal(restedIds.size, 8);
  assert.ok(cup.participants.every(team => openingIds.has(team.id) !== restedIds.has(team.id)));
  assert.ok(cup.participants.filter(team => team.level === 1).every(team => restedIds.has(team.id)));
  for (const [pairIndex, pairing] of firstRound.entries()) {
    assert.equal(pairing.away.seed, 119 - pairIndex * 2, 'adjacent stronger team must be AWAY');
    assert.equal(pairing.home.seed, 120 - pairIndex * 2, 'adjacent weaker team must be HOME');
    assert.notEqual(pairing.away.level, 1);
    assert.notEqual(pairing.home.level, 1);
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

  // Every participant, including D1's eight round-two entrants, has a frozen snapshot.
  const restedD1Team = cup.openingRoundRestTeams[0];
  const d1SnapshotRef = db.collection('cup_participant_snapshots_v1').doc(cupRef.id).collection('teams').doc(restedD1Team.id);
  const d1Snapshot = await d1SnapshotRef.get();
  assert.equal(d1Snapshot.exists, true);
  const d1SnapshotData = d1Snapshot.data();
  await d1SnapshotRef.delete();
  const incompleteRetry = await preparePyramidCupForSeason(season);
  assert.equal(incompleteRetry.success, false);
  assert.equal(incompleteRetry.reason, 'CUP_PREPARED_PARTICIPANT_SNAPSHOT_INVALID');
  await d1SnapshotRef.set(d1SnapshotData);

  const retry = await preparePyramidCupForSeason(season);
  assert.equal(retry.success, true, JSON.stringify(retry));
  assert.equal(retry.alreadyExists, true);
  assert.equal((await cupRef.get()).data().rounds.r1.length, 56);

  // A retry must reject a participant registry that no longer matches the
  // 120 clubs represented by round one, even when both records have valid counts.
  const canonicalParticipants = (await cupRef.get()).data().participants;
  const corruptedParticipants = canonicalParticipants.map(team => ({ ...team }));
  corruptedParticipants[0].id = 'CORRUPTED_CUP_PARTICIPANT';
  await cupRef.update({ participants: corruptedParticipants });
  const membershipRetry = await preparePyramidCupForSeason(season);
  assert.equal(membershipRetry.success, false);
  assert.equal(membershipRetry.reason, 'CUP_PREPARED_BRACKET_MEMBERSHIP_INVALID');
  await cupRef.update({ participants: canonicalParticipants });
  const restoredMembershipRetry = await preparePyramidCupForSeason(season);
  assert.equal(restoredMembershipRetry.success, true, JSON.stringify(restoredMembershipRetry));

  // A fixture must carry the exact frozen snapshots stored for both entrants,
  // not merely a matching team ID and five-player array.
  const snapshotIntegrityPairing = firstRound[0];
  const snapshotIntegrityFixtureRef = db.collection(MATCH_COLLECTIONS.cup).doc(snapshotIntegrityPairing.matchId);
  const snapshotIntegrityFixture = (await snapshotIntegrityFixtureRef.get()).data();
  const canonicalHomeSnapshot = snapshotIntegrityFixture.homeTeamSnapshot;
  await snapshotIntegrityFixtureRef.update({
    homeTeamSnapshot: {
      ...canonicalHomeSnapshot,
      players: canonicalHomeSnapshot.players.map((player, index) =>
        index === 0 ? { ...player, overallRating: Number(player.overallRating || 0) + 1 } : player
      ),
    },
  });
  const corruptedFixtureSnapshotRetry = await preparePyramidCupForSeason(season);
  assert.equal(corruptedFixtureSnapshotRetry.success, false);
  assert.equal(corruptedFixtureSnapshotRetry.reason, 'CUP_PREPARED_FIXTURE_SNAPSHOT_INVALID');
  await snapshotIntegrityFixtureRef.update({ homeTeamSnapshot: canonicalHomeSnapshot });

  // Pairing identities and indexes are canonical, not just unique. A retry
  // must reject a bracket that silently changes a deterministic pairing ID.
  const canonicalRounds = (await cupRef.get()).data().rounds;
  const corruptedRounds = { ...canonicalRounds, r1: canonicalRounds.r1.map(pairing => ({ ...pairing })) };
  corruptedRounds.r1[0].id = 'r1_m999';
  await cupRef.update({ rounds: corruptedRounds });
  const corruptedPairingRetry = await preparePyramidCupForSeason(season);
  assert.equal(corruptedPairingRetry.success, false);
  assert.equal(corruptedPairingRetry.reason, 'CUP_PREPARED_BRACKET_PAIRINGS_INVALID');
  await cupRef.update({ rounds: canonicalRounds });
  const restoredPairingRetry = await preparePyramidCupForSeason(season);
  assert.equal(restoredPairingRetry.success, true, JSON.stringify(restoredPairingRetry));

  // The participant roster is frozen at generation. Even if a replaced bot's
  // live profile is retired by registration, its published Cup fixture remains playable.
  const firstPairing = firstRound[0];
  assert.equal(firstPairing.home.id, humanUid, 'the weakest D4 team should be HOME against its adjacent opponent');
  assert.equal(firstPairing.away.seed, 119, 'the adjacent stronger team must be AWAY');
  assert.equal(firstPairing.home.seed, 120);
  assert.equal(cup.openingRoundRestTeams.length, 8);
  assert.ok(cup.openingRoundRestTeams.every(team => team.level === 1));
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

  // Move the isolated emulator fixture clock into an active, due window so
  // the real worker can advance every round without waiting for wall-clock days.
  const runtimeSeasonStart = new Date(Date.now() - 10 * 86400000);
  await cupRef.update({ seasonStart: runtimeSeasonStart.toISOString() });
  // Round 1 is scheduled on season day 2 at 07:00 Moscow (04:00 UTC).
  // Keep fixture timestamps aligned with the immutable schedule contract while
  // moving the isolated clock far enough forward for the worker to resolve it.
  const runtimeRoundOneStart = new Date(runtimeSeasonStart.getTime() + 86400000);
  runtimeRoundOneStart.setUTCHours(4, 0, 0, 0);
  await Promise.all(firstRound.map(pairing => db.collection(MATCH_COLLECTIONS.cup).doc(pairing.matchId).update({
    scheduledAt: runtimeRoundOneStart,
    startTime: runtimeRoundOneStart,
    scheduledStartAt: runtimeRoundOneStart,
  })));
  await configRef.set({
    activeSeasonNumber: season,
    phase: 'REGULAR_SEASON',
    worldReady: true,
    seasonStart: runtimeSeasonStart.toISOString(),
    nextSeasonStart: new Date(runtimeSeasonStart.getTime() + 15 * 86400000).toISOString(),
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
    // Two workers may pick up the same due round concurrently. The
    // transaction's expected-round guard must allow exactly one advancement.
    const [advanced, duplicate] = await Promise.all([
      runPyramidCupCycle(),
      runPyramidCupCycle(),
    ]);
    assert.equal([advanced.advanced, duplicate.advanced].reduce((sum, value) => sum + Number(value || 0), 0), 1,
      JSON.stringify({ round, advanced, duplicate }));
    // The second worker may observe either the stale old round or the newly
    // committed next round; both are safe as long as it cannot advance twice.
    const nextCup = (await cupRef.get()).data();
    assert.equal(nextCup.currentRound, round + 1);
    const nextPairings = nextCup.rounds[`r${round + 1}`];
    assert.equal(nextPairings.filter(value => value.home && value.away).length, EXPECTED_MATCHES[round + 1]);
    assert.equal(nextPairings.length, EXPECTED_PAIRINGS[round + 1]);
    assert.equal(nextPairings.some(value => value.status === 'bye'), false, 'no round may contain a BYE');
    if (round === 1) {
      const d1Ids = new Set(cup.openingRoundRestTeams.map(team => team.id));
      const nextRoundTeamIds = new Set(nextPairings.flatMap(value => [value.home.id, value.away.id]));
      assert.equal(nextPairings.length, 32);
      assert.ok([...d1Ids].every(id => nextRoundTeamIds.has(id)), 'all eight D1 teams must join round two');
    }
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
  assert.equal(finalCup.totalMatches, 119);
  assert.equal(fixtureRefs.length, 119, 'the complete no-BYE bracket must create exactly 119 fixtures');
  assert.equal(new Set(fixtureRefs.map(ref => ref.id)).size, 119);
  assert.equal(finalCup.currentRound, 7);
  const finalPairing = finalCup.rounds.r7[0];
  const finalRef = db.collection(MATCH_COLLECTIONS.cup).doc(finalPairing.matchId);
  assert.equal((await finalRef.get()).data().bestOf, 3, 'the championship final must be BO3');
  await finalRef.update({
    status: 'finished',
    isFinished: true,
    isProcessing: false,
    winnerId: finalPairing.home.id,
    scoreA: 2,
    scoreB: 0,
  });
  // Legacy integer-string balances are accepted by the Cup settlement reader.
  await db.collection('players_v14').doc(humanUid).update({ credits: '1000000' });
  const completed = await runPyramidCupCycle();
  assert.equal(completed.completed, true, JSON.stringify(completed));
  const completedCup = (await cupRef.get()).data();
  assert.equal(completedCup.status, 'completed');
  assert.equal(completedCup.winnerId, finalPairing.home.id);
  assert.equal(completedCup.winnerId, humanUid);
  assert.equal(completedCup.winnerName, finalPairing.home.name);
  const championProfile = (await db.collection('players_v14').doc(humanUid).get()).data();
  assert.equal(championProfile.credits, 1_035_000);
  assert.ok(championProfile.trophies.some(trophy => trophy.id === `pyramid-cup-season-${season}`));
  const championLedger = (await economyRefs[0].get()).data();
  assert.equal(championLedger.amount, 35_000);
  assert.equal(championLedger.type, 'PYRAMID_CUP_CHAMPION_REWARD');

  const championAfterFirstPayout = (await db.collection('players_v14').doc(humanUid).get()).data();
  assert.equal(championAfterFirstPayout.credits, 1_035_000);

  // Simulate an interrupted root completion. A replay receipt must not bypass
  // the recipient-profile guard, even though the credits were already posted.
  await cupRef.update({ status: 'active' });
  await db.collection('players_v14').doc(humanUid).delete();
  await assert.rejects(
    () => runPyramidCupCycle(),
    /CUP_PRIZE_RECIPIENT_PROFILE_MISSING/,
  );
  assert.equal((await cupRef.get()).data().status, 'active');
  assert.deepEqual((await economyRefs[0].get()).data(), championLedger);

  // Restore the profile with its already-credited balance but remove the Cup
  // trophy. Replay repairs that trophy only; it must never credit a second time.
  const championWithoutCupTrophy = {
    ...championAfterFirstPayout,
    trophies: championAfterFirstPayout.trophies.filter(trophy => trophy.id !== `pyramid-cup-season-${season}`),
  };
  await db.collection('players_v14').doc(humanUid).set(championWithoutCupTrophy);
  const resumedFinalization = await runPyramidCupCycle();
  assert.equal(resumedFinalization.completed, true, JSON.stringify(resumedFinalization));
  const resumedCup = (await cupRef.get()).data();
  assert.equal(resumedCup.status, 'completed');
  const resumedChampion = (await db.collection('players_v14').doc(humanUid).get()).data();
  assert.equal(resumedChampion.credits, 1_035_000);
  assert.equal(resumedChampion.trophies.filter(trophy => trophy.id === 'pyramid-cup-season-' + season).length, 1);
  assert.deepEqual((await economyRefs[0].get()).data(), championLedger);

  // A retry after completion must be a strict no-op: no second reward,
  // no duplicate trophy, and no mutation of the published champion record.
  const completedSnapshot = {
    winnerId: completedCup.winnerId,
    winnerName: completedCup.winnerName,
    finalistId: completedCup.finalistId,
    finalistName: completedCup.finalistName,
    championPrize: completedCup.championPrize,
    finalistPrize: completedCup.finalistPrize,
  };
  const retryCycle = await runPyramidCupCycle();
  assert.equal(retryCycle.completed, true);
  assert.equal(retryCycle.advanced, 0);
  const afterRetryCup = (await cupRef.get()).data();
  assert.deepEqual({
    winnerId: afterRetryCup.winnerId,
    winnerName: afterRetryCup.winnerName,
    finalistId: afterRetryCup.finalistId,
    finalistName: afterRetryCup.finalistName,
    championPrize: afterRetryCup.championPrize,
    finalistPrize: afterRetryCup.finalistPrize,
  }, completedSnapshot);
  const championAfterRetry = (await db.collection('players_v14').doc(humanUid).get()).data();
  assert.equal(championAfterRetry.credits, 1_035_000);
  assert.equal(championAfterRetry.trophies.filter(trophy => trophy.id === `pyramid-cup-season-${season}`).length, 1);
  const championLedgerAfterRetry = (await economyRefs[0].get()).data();
  assert.deepEqual(championLedgerAfterRetry, championLedger);

  const leagueTablesAfterCup = await Promise.all(tableRefs.map(async ref => {
    const snap = await ref.get();
    assert.equal(snap.exists, true);
    return JSON.stringify(snap.data());
  }));
  assert.deepEqual(leagueTablesAfterCup, leagueTablesBeforeCup,
    'Pyramid Cup matches and rewards must not change any of the 15 league tables');
});


test('a pristine emulator publishes Season 1 only after its complete Pyramid Cup is ready', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);

  const [{ getAdminDb }, { ensureSeasonCalendar }, { getTableId, MAX_LEVELS, TEAMS_PER_GROUP }, { MATCH_COLLECTIONS }] = await Promise.all([
    import('../src/lib/firebase-admin.ts'),
    import('../src/app/actions/season-calendar.ts'),
    import('../src/app/lib/leagues-data.ts'),
    import('../src/app/lib/match-storage.ts'),
  ]);
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const app = getApps().find(candidate => candidate.name === '[DEFAULT]');
  t.after(async () => {
    if (app) await deleteApp(app).catch(() => undefined);
  });

  // The isolated emulator must be genuinely empty before the first canonical build.
  const [existingConfig, existingSystem, existingTables, existingSlots, existingMatches, existingPlayers, existingCups, existingCupMatches] = await Promise.all([
    configRef.get(),
    db.collection('system_v1').limit(1).get(),
    db.collection('league_tables_v2').limit(1).get(),
    db.collection('league_slots_v1').limit(1).get(),
    db.collection('matches_v2').limit(1).get(),
    db.collection('players_v14').limit(1).get(),
    db.collection('cup_pyramid_v1').limit(1).get(),
    db.collection(MATCH_COLLECTIONS.cup).limit(1).get(),
  ]);
  assert.equal(existingConfig.exists, false);
  assert.equal(existingSystem.empty, true);
  assert.equal(existingTables.empty, true);
  assert.equal(existingSlots.empty, true);
  assert.equal(existingMatches.empty, true);
  assert.equal(existingPlayers.empty, true);
  assert.equal(existingCups.empty, true);
  assert.equal(existingCupMatches.empty, true);

  const world = await ensureSeasonCalendar(1);
  assert.equal(world.success, true, JSON.stringify(world));
  assert.equal(world.worldReady, true);
  assert.equal(world.seasonNumber, 1);

  const config = (await configRef.get()).data();
  assert.equal(config.activeSeasonNumber, 1);
  assert.equal(config.phase, 'REGULAR_SEASON');
  assert.equal(config.worldReady, true);
  assert.equal(config.pyramidCupRequired, true);
  assert.equal(config.pyramidCupReady, true);

  const [tablesSnap, slotsSnap, leagueMatchesSnap] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
    db.collection('matches_v2').where('season', '==', 1).where('version', '==', 140).get(),
  ]);
  assert.equal(tablesSnap.size, 15);
  assert.equal(slotsSnap.size, 120);
  assert.equal(leagueMatchesSnap.size, 840);

  const leagueTablesBeforeCup = tablesSnap.docs.map(doc => JSON.stringify(doc.data()));
  const generated = world.pyramidCup;
  assert.equal(generated.success, true, JSON.stringify(generated));
  assert.equal(generated.created, true);
  assert.equal(generated.participants, 120);
  assert.equal(generated.preliminaryMatches, 56);
  assert.equal(generated.totalMatches, 119);

  const cupRef = db.collection('cup_pyramid_v1').doc('cup_s1_lALPHA');
  const cupSnap = await cupRef.get();
  assert.equal(cupSnap.exists, true);
  const cup = cupSnap.data();
  assert.equal(cup.status, 'active');
  assert.equal(cup.season, 1);
  assert.equal(cup.totalParticipants, 120);
  assert.equal(cup.preliminaryMatches, 56);
  assert.equal(cup.byeCount, 0);
  assert.equal(cup.formatVersion, 4);
  assert.equal(cup.openingRoundRestCount, 8);
  assert.equal(cup.openingRoundRestTeams.length, 8);
  assert.ok(cup.openingRoundRestTeams.every(team => team.level === 1));
  assert.equal(cup.rounds.r1.length, 56);

  const firstRound = cup.rounds.r1;
  for (const [index, pairing] of firstRound.entries()) {
    assert.equal(pairing.away.seed, 119 - index * 2);
    assert.equal(pairing.home.seed, 120 - index * 2);
    assert.notEqual(pairing.away.level, 1);
    assert.notEqual(pairing.home.level, 1);
    assert.equal(pairing.status, 'scheduled');
    const fixture = await db.collection(MATCH_COLLECTIONS.cup).doc(pairing.matchId).get();
    assert.equal(fixture.exists, true);
    assert.equal(fixture.data().bestOf, 1);
    assert.equal(fixture.data().awayId, pairing.away.id);
    assert.equal(fixture.data().homeId, pairing.home.id);
  }

  const participantSnapshots = await db.collection('cup_participant_snapshots_v1')
    .doc(cupRef.id).collection('teams').get();
  assert.equal(participantSnapshots.size, 120);

  const leagueTablesAfterCup = await Promise.all(tablesSnap.docs.map(async tableDoc => {
    const current = await tableDoc.ref.get();
    return JSON.stringify(current.data());
  }));
  assert.deepEqual(leagueTablesAfterCup, leagueTablesBeforeCup,
    'creating the Pyramid Cup must not alter the 15 canonical league tables');
});
