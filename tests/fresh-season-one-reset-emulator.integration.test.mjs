import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.GCLOUD_PROJECT = 'demo-forge-rivals-reset-test';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const uid = 'RESETTHUMANUID';
const CUP_ID = 'cup_s1_lALPHA';

test('fresh Season 1 reset rebuilds league and Pyramid Cup while preserving Firebase Auth and unrelated fixtures', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  const [{ getAdminDb }, { buildBotClub }, { createFreshSeasonOneHumanClubProfile }, { executeFreshSeasonOneReset }] = await Promise.all([
    import('../src/lib/firebase-admin.ts'),
    import('../src/app/actions/bot-roster.ts'),
    import('../src/app/actions/fresh-season-one-player-reset.ts'),
    import('../src/app/actions/fresh-season-one-reset-executor.ts'),
  ]);
  const db = getAdminDb();
  const app = getApps()[0];
  const auth = getAuth(app);
  const collections = [
    'system_v1', 'league_tables_v2', 'league_slots_v1', 'players_v14', 'matches_v2',
    'cup_pyramid_v1', 'cup_matches', 'cup_participant_snapshots_v1',
    'league_season_archives_v1', 'league_season_rollovers_v1', 'league_season_history_v1',
    'league_slot_history_v1', 'match_player_effects_v1', 'economy_transactions',
    'match_consequence_receipts', 'staging_season_one_reset_archives_v1',
  ];
  const clearCollection = async (name) => {
    const snap = await db.collection(name).get();
    for (let offset = 0; offset < snap.docs.length; offset += 400) {
      const batch = db.batch();
      snap.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  };

  await auth.createUser({ uid, email: 'reset-test@example.invalid', password: 'emulator-only-password' });
  t.after(async () => {
    const nestedSnapshots = await db.collection('cup_participant_snapshots_v1').doc(CUP_ID).collection('teams').get().catch(() => null);
    if (nestedSnapshots) for (let offset = 0; offset < nestedSnapshots.docs.length; offset += 400) {
      const batch = db.batch();
      nestedSnapshots.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
      await batch.commit().catch(() => undefined);
    }
    const nestedArchive = await db.collection('league_season_archives_v1').doc('S1').collection('matches').get().catch(() => null);
    if (nestedArchive) for (const doc of nestedArchive.docs) await doc.ref.delete().catch(() => undefined);
    for (const name of collections) await clearCollection(name).catch(() => undefined);
    await auth.deleteUser(uid).catch(() => undefined);
    const defaultApp = getApps().find(candidate => candidate.name === '[DEFAULT]');
    if (defaultApp) await deleteApp(defaultApp).catch(() => undefined);
  });

  const start = new Date();
  start.setUTCHours(15, 0, 0, 0);
  if (start.getTime() <= Date.now()) start.setUTCDate(start.getUTCDate() + 1);
  const target = {
    seasonStart: start.toISOString(),
    nextSeasonStart: new Date(start.getTime() + 17 * 86400000).toISOString(),
  };
  await db.collection('system_v1').doc('season_config').set({
    activeSeasonNumber: 1, phase: 'REGULAR_SEASON', worldReady: true,
    worldGeneration: 'CLEAN_S1_V1', seasonStart: target.seasonStart,
    nextSeasonStart: target.nextSeasonStart, calendarRevision: 4,
    pyramidCupRequired: true, pyramidCupReady: true, pyramidCupReadySeasonNumber: 1,
  });
  await db.collection('system_v1').doc('global_stats').set({ totalPlayers: 1200 });

  const tableWrites = [];
  const slotWrites = [];
  const profileWrites = [];
  let oldHumanProfile = null;
  const participants = [];
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const stats = {};
      for (let rank = 1; rank <= 8; rank++) {
        const isHuman = level === 2 && group === 1 && rank === 3;
        const id = isHuman ? uid : `BOT_ALPHA_L${level}_G${group}_R${rank}`;
        const name = isHuman ? 'Old Club Name' : `Bot D${level} G${group} R${rank}`;
        const team = { id, name, level, group, rank, isBot: !isHuman };
        participants.push(team);
        stats[id] = {
          id, name, rank, isBot: !isHuman,
          matchesPlayed: 14, wins: 8, draws: 2, losses: 4, points: 26, diff: 10,
        };
        const slotId = `S1_LALPHA_D${level}_G${group}_R${rank}`;
        slotWrites.push({
          ref: db.collection('league_slots_v1').doc(slotId),
          data: {
            season: 1, leagueId: 'ALPHA', division: level, group, rank,
            status: isHuman ? 'OCCUPIED' : 'FREE',
            occupantId: isHuman ? uid : null,
            occupancyGeneration: isHuman ? 5 : 0,
          },
        });
        const profile = isHuman
          ? createFreshSeasonOneHumanClubProfile({
              id: uid, email: 'reset-test@example.invalid', displayName: 'Old Club Name',
              clubName: 'Old Club Name', numericId: 1201,
            }, { tier: level, group, rank }, 1, new Date('2026-11-01T15:00:00.000Z'))
          : buildBotClub(id, name);
        if (isHuman) {
          profile.clubName = 'Old Club Name';
          profile.displayName = 'Old Club Name';
          profile.ownedPlayers = profile.ownedPlayers.map((player, index) => ({ ...player, id: `old_player_${index}` }));
        }
        if (isHuman) oldHumanProfile = profile;
        else profileWrites.push({ ref: db.collection('players_v14').doc(id), data: profile });
      }
      const tableId = `table_v140_S1_LALPHA_V${level}_G${group}`;
      tableWrites.push({
        ref: db.collection('league_tables_v2').doc(tableId),
        data: {
          id: tableId, leagueId: 'ALPHA', level, group, season: 1, version: 140,
          scheduleRevision: 4, championId: 'STALE_CHAMPION', previousSeasonSummary: { points: 999 }, stats,
        },
      });
    }
  }

  const writeBatches = [...tableWrites, ...slotWrites, ...profileWrites];
  for (let offset = 0; offset < writeBatches.length; offset += 400) {
    const batch = db.batch();
    writeBatches.slice(offset, offset + 400).forEach(write => batch.set(write.ref, write.data));
    await batch.commit();
  }
  assert.equal(participants.length, 120);

  // Old league fixtures and old Pyramid Cup artifacts must be removed.
  const oldMatchWrites = [];
  let oldMatchNumber = 0;
  for (const team of participants.filter(item => item.level === 4)) {
    oldMatchNumber++;
    oldMatchWrites.push({
      ref: db.collection('matches_v2').doc(`old_s1_league_${oldMatchNumber}`),
      data: {
        id: `old_s1_league_${oldMatchNumber}`, season: 1, version: 140, leagueId: 'ALPHA',
        level: team.level, groupId: team.group, homeId: team.id, awayId: 'BOT_ALPHA_L4_G8_R1',
        homeRank: team.rank, awayRank: 1, type: 'league', status: 'scheduled',
      },
    });
  }
  for (let index = 0; index < 56; index++) {
    oldMatchWrites.push({
      ref: db.collection('cup_matches').doc(`cup_S1_R1_M${String(index + 1).padStart(2, '0')}`),
      data: { id: `cup_S1_R1_M${String(index + 1).padStart(2, '0')}`, cupId: CUP_ID, season: 1, cupRound: 1 },
    });
  }
  oldMatchWrites.push({
    ref: db.collection('matches_v2').doc('old_s1_legacy_cup'),
    data: { id: 'old_s1_legacy_cup', season: 1, version: 140, leagueId: 'ALPHA', cupId: CUP_ID, type: 'cup' },
  });
  // These independent fixtures are outside the reset's exact S1 league/Cup scope.
  oldMatchWrites.push({
    ref: db.collection('matches_v2').doc('unrelated_tournament_fixture'),
    data: { id: 'unrelated_tournament_fixture', season: 1, version: 141, leagueId: 'BETA', tournamentId: 'TOURNAMENT_KEEP', type: 'tournament' },
  });
  oldMatchWrites.push({
    ref: db.collection('matches_v2').doc('unrelated_friendly_fixture'),
    data: { id: 'unrelated_friendly_fixture', season: 1, version: 141, leagueId: 'FRIENDLY', isFriendly: true, type: 'friendly' },
  });
  for (let offset = 0; offset < oldMatchWrites.length; offset += 400) {
    const batch = db.batch();
    oldMatchWrites.slice(offset, offset + 400).forEach(write => batch.set(write.ref, write.data));
    await batch.commit();
  }

  const cupParticipants = participants.map((team, index) => ({
    id: team.id, name: team.name, level: team.level, group: team.group, rank: team.rank,
    seed: index + 1, isBot: team.isBot,
  }));
  await db.collection('cup_pyramid_v1').doc(CUP_ID).set({
    id: CUP_ID, season: 1, leagueId: 'ALPHA', name: 'Кубок Пирамиды',
    totalParticipants: 120, totalMatches: 119, formatVersion: 4, format: 'D1_REST_OPENING_ROUND',
    participants: cupParticipants, rounds: { r1: Array.from({ length: 56 }, (_, i) => ({ id: `r1_m${i + 1}` })) },
  });
  const snapshotBatch = db.batch();
  participants.forEach(team => snapshotBatch.set(
    db.collection('cup_participant_snapshots_v1').doc(CUP_ID).collection('teams').doc(team.id),
    { cupId: CUP_ID, season: 1, teamId: team.id, matchSnapshot: { players: [] } },
  ));
  await snapshotBatch.commit();

  await Promise.all([
    db.collection('league_season_archives_v1').doc('S1').set({ season: 1 }),
    db.collection('league_season_archives_v1').doc('S1').collection('matches').doc('old').set({ season: 1 }),
    db.collection('league_season_rollovers_v1').doc('S2').set({ sourceSeason: 1, targetSeason: 2 }),
    db.collection('league_season_history_v1').doc('S1').set({ season: 1 }),
    db.collection('league_slot_history_v1').doc('S1_LALPHA_D2_G1_R3_G5').set({
      slotId: 'S1_LALPHA_D2_G1_R3', season: 1, leagueId: 'ALPHA', generation: 5,
    }),
    db.collection('match_player_effects_v1').doc('old-effect').set({ matchId: 'match_v140_S1_LALPHA_OLD' }),
    db.collection('economy_transactions').doc('old-league-revenue').set({ referenceId: 'match_v140_S1_LALPHA_OLD', type: 'MATCH_REVENUE' }),
    db.collection('economy_transactions').doc('old-cup-revenue').set({ referenceId: 'cup_S1_R1_M01', type: 'MATCH_REVENUE' }),
    db.collection('economy_transactions').doc('old-season-reward').set({ referenceId: 'S1', type: 'LEAGUE_SEASON_REWARD' }),
    db.collection('economy_transactions').doc('old-cup-reward').set({ referenceId: CUP_ID, type: 'PYRAMID_CUP_CHAMPION_REWARD' }),
    db.collection('match_consequence_receipts').doc('old-consequence').set({ matchId: 'match_v140_S1_LALPHA_OLD' }),
  ]);

  // A missing source profile must stop before deletion; the archive cannot be marked complete.
  await assert.rejects(executeFreshSeasonOneReset(db, target), /SEASON_ONE_ARCHIVE_CORE_WORLD_INCOMPLETE/);
  const failedJournal = (await db.collection('system_v1').doc('staging_fresh_season_one_reset_v1').get()).data();
  assert.equal(failedJournal.status, 'FAILED');
  assert.equal(failedJournal.stepIndex, 0);
  const frozenConfig = (await db.collection('system_v1').doc('season_config').get()).data();
  assert.equal(frozenConfig.worldReady, false);
  assert.equal(frozenConfig.stagingSeasonOneResetInProgress, true);
  assert.equal((await db.collection('matches_v2').doc('old_s1_league_1').get()).exists, true);
  assert.equal((await db.collection('staging_season_one_reset_archives_v1').doc(failedJournal.resetId).get()).exists, false);
  await db.collection('players_v14').doc(uid).set(oldHumanProfile);

  // Force a mid-archive interruption after the first 350-document batch,
  // then resume the same reset archive deterministically before deletion.
  const { createOrVerifyDurableSeasonOneArchive } = await import('../src/app/actions/staging-season-one-reset-durable-archive.ts');
  let ownershipChecks = 0;
  await assert.rejects(
    createOrVerifyDurableSeasonOneArchive(db, failedJournal.resetId, failedJournal.sourceConfig, async () => {
      ownershipChecks++;
      if (ownershipChecks === 3) throw new Error('SIMULATED_ARCHIVE_INTERRUPTION');
    }),
    /SIMULATED_ARCHIVE_INTERRUPTION/,
  );
  const interruptedArchiveRef = db.collection('staging_season_one_reset_archives_v1').doc(failedJournal.resetId);
  const interruptedManifest = (await interruptedArchiveRef.get()).data();
  assert.equal(interruptedManifest.status, 'WRITING');
  assert.equal(interruptedManifest.persistedCount, 350);
  assert.equal((await interruptedArchiveRef.collection('documents').get()).size, 350);
  const resumedArchive = await createOrVerifyDurableSeasonOneArchive(db, failedJournal.resetId, failedJournal.sourceConfig);
  assert.equal(resumedArchive.archiveStatus, 'COMPLETE');
  assert.ok(resumedArchive.archiveDocuments > 350);

  const result = await executeFreshSeasonOneReset(db, target);
  assert.equal(result.success, true);
  assert.equal(result.verification.tables, 15);
  assert.equal(result.verification.slots, 120);
  assert.equal(result.verification.leagueMatches, 840);
  assert.equal(result.verification.cupParticipants, 120);
  assert.equal(result.verification.cupMatches, 56);
  assert.equal(result.verification.cupParticipantSnapshots, 120);
  assert.equal(result.verification.humanClubs, 1);
  assert.equal(result.verification.botClubs, 119);
  const durableArchiveRef = db.collection('staging_season_one_reset_archives_v1').doc(result.resetId);
  const durableArchive = (await durableArchiveRef.get()).data();
  assert.equal(durableArchive.status, 'COMPLETE');
  assert.equal(durableArchive.sourceCount, durableArchive.persistedCount);
  assert.ok(durableArchive.sourceCount >= 300);
  const archivedDocs = await durableArchiveRef.collection('documents').get();
  assert.equal(archivedDocs.size, durableArchive.sourceCount);
  assert.ok(archivedDocs.docs.some(doc => doc.data().sourcePath === 'system_v1/season_config'));
  assert.ok(archivedDocs.docs.some(doc => doc.data().sourcePath === 'league_slot_history_v1/S1_LALPHA_D2_G1_R3_G5'));
  const resetJournalData = (await db.collection('system_v1').doc('staging_fresh_season_one_reset_v1').get()).data();
  const { createOrVerifyDurableSeasonOneArchive } = await import('../src/app/actions/staging-season-one-reset-durable-archive.ts');
  const reusedArchive = await createOrVerifyDurableSeasonOneArchive(db, result.resetId, resetJournalData.sourceConfig);
  assert.equal(reusedArchive.reusedCompletedArchive, true);
  assert.equal(reusedArchive.archiveDocuments, durableArchive.sourceCount);

  const authUser = await auth.getUser(uid);
  assert.equal(authUser.email, 'reset-test@example.invalid');
  const humanProfile = (await db.collection('players_v14').doc(uid).get()).data();
  assert.equal(humanProfile.clubName, `New Club ${uid.slice(0, 6).toUpperCase()}`);
  assert.equal(humanProfile.credits, 1_000_000);
  assert.equal(humanProfile.crystals, 50);
  assert.equal(humanProfile.ownedPlayers.length, 10);
  assert.ok(humanProfile.ownedPlayers.every((player) => !player.id.startsWith('old_player_')));

  const slot = (await db.collection('league_slots_v1').doc('S1_LALPHA_D2_G1_R3').get()).data();
  assert.equal(slot.status, 'OCCUPIED');
  assert.equal(slot.occupantId, uid);
  assert.equal(slot.occupancyGeneration, 0);
  assert.equal((await db.collection('league_slot_history_v1').get()).size, 0);
  assert.equal((await db.collection('cup_pyramid_v1').doc(CUP_ID).get()).exists, true);
  assert.equal((await db.collection('matches_v2').doc('unrelated_tournament_fixture').get()).exists, true);
  assert.equal((await db.collection('matches_v2').doc('unrelated_friendly_fixture').get()).exists, true);

  const repeated = await executeFreshSeasonOneReset(db, target);
  assert.equal(repeated.alreadyCompleted, true);
});
