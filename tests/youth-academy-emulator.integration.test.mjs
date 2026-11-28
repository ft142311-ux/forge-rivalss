import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { generateScoutedPlayer } from '../src/app/lib/moba-data.ts';
import {
  completeDailyYouthTrainingWithDb,
  promoteYouthPlayerWithDb,
  recruitYouthCandidateWithDb,
  scoutYouthCandidatesWithDb,
  startDailyTrainingWithDb,
} from '../src/app/lib/youth-academy.ts';
import { createYouthMarketListingWithDb } from '../src/app/lib/market-listing.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

async function withIsolatedFirestore(t) {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');
  const app = initializeApp({ projectId }, 'youth-academy-test-' + randomUUID());
  const firestore = getFirestore(app);
  const prefix = 'youthAcademyTest_' + randomUUID().replaceAll('-', '') + '_';
  const db = {
    collection: name => firestore.collection(prefix + name),
    runTransaction: callback => firestore.runTransaction(callback),
  };
  t.after(async () => {
    for (const name of ['players_v14', 'system_v1', 'market_v7']) {
      const snapshot = await db.collection(name).get();
      if (!snapshot.empty) {
        const batch = firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    await deleteApp(app);
  });
  return db;
}

test('Firestore Emulator scouts and recruits candidates atomically with unique IDs and capacity checks', {
  skip: !emulatorHost,
}, async t => {
  const db = await withIsolatedFirestore(t);
  const uid = 'youth-manager-' + randomUUID();
  const nowMs = 1_800_000_000_000;
  const profileRef = db.collection('players_v14').doc(uid);
  await profileRef.set({
    ownedPlayers: [],
    youthAcademyPlayers: [],
    scoutingCandidates: [],
    academy: { scoutsLevel: 3, youthBootcampLevel: 0 },
  });

  const scan = await scoutYouthCandidatesWithDb(db, uid, { nowMs, scanId: 'emulator-scan' });
  assert.equal(scan.success, true);
  assert.equal(scan.count, 5);
  const afterScan = await profileRef.get();
  const candidates = afterScan.get('scoutingCandidates');
  assert.equal(candidates.length, 5);
  assert.equal(new Set(candidates.map(player => player.id)).size, 5);
  assert.ok(candidates.every(player => player.isYouth === true));
  assert.equal(candidates[0].hiredAt, new Date(nowMs).toISOString());

  const recruitedId = candidates[0].id;
  const recruited = await recruitYouthCandidateWithDb(db, uid, recruitedId);
  assert.equal(recruited.success, true);
  const afterRecruit = await profileRef.get();
  assert.equal(afterRecruit.get('youthAcademyPlayers').length, 1);
  assert.equal(afterRecruit.get('scoutingCandidates').length, 4);
  const repeated = await recruitYouthCandidateWithDb(db, uid, recruitedId);
  assert.equal(repeated.alreadyRecruited, true);
});

test('Firestore Emulator rejects recruitment when the youth academy is full', {
  skip: !emulatorHost,
}, async t => {
  const db = await withIsolatedFirestore(t);
  const uid = 'youth-full-manager-' + randomUUID();
  const candidate = generateScoutedPlayer(0, 1, 'full-academy-candidate', 1_800_000_000_000);
  const fullRoster = Array.from({ length: 10 }, (_, index) => ({ ...candidate, id: 'owned-youth-' + index }));
  await db.collection('players_v14').doc(uid).set({
    ownedPlayers: [],
    youthAcademyPlayers: fullRoster,
    scoutingCandidates: [candidate],
    academy: { youthBootcampLevel: 0 },
  });
  await assert.rejects(recruitYouthCandidateWithDb(db, uid, candidate.id), /YOUTH_ACADEMY_FULL/);
  const profile = await db.collection('players_v14').doc(uid).get();
  assert.equal(profile.get('youthAcademyPlayers').length, 10);
  assert.equal(profile.get('scoutingCandidates').length, 1);
});

test('Firestore Emulator starts and completes one youth training cycle without allowing a concurrent market listing', {
  skip: !emulatorHost,
}, async t => {
  const db = await withIsolatedFirestore(t);
  const uid = 'youth-training-manager-' + randomUUID();
  const nowMs = 1_800_000_000_000;
  const player = generateScoutedPlayer(0, 2, 'training-candidate', nowMs);
  const profileRef = db.collection('players_v14').doc(uid);
  await profileRef.set({
    ownedPlayers: [],
    youthAcademyPlayers: [player],
    academy: {},
  });
  await profileRef.update({ ownedPlayers: [{ ...player, isYouth: false }] });
  await assert.rejects(createYouthMarketListingWithDb(db, uid, player.id, nowMs), /PLAYER_OWNERSHIP_AMBIGUOUS/);
  await profileRef.update({ ownedPlayers: [] });

  const started = await startDailyTrainingWithDb(db, uid, player.id, 'lastHitting', nowMs);
  assert.equal(started.success, true);
  assert.equal(started.finishTime, new Date(nowMs + 24 * 60 * 60 * 1000).toISOString());
  await assert.rejects(startDailyTrainingWithDb(db, uid, player.id, 'lastHitting', nowMs + 1), /TRAINING_ALREADY_IN_PROGRESS/);
  await assert.rejects(createYouthMarketListingWithDb(db, uid, player.id, nowMs + 1), /YOUTH_TRAINING_IN_PROGRESS/);
  await profileRef.update({ ownedPlayers: [{ ...player, isYouth: false }] });
  await assert.rejects(
    completeDailyYouthTrainingWithDb(db, uid, player.id, nowMs + 24 * 60 * 60 * 1000),
    /PLAYER_OWNERSHIP_AMBIGUOUS/,
  );
  await profileRef.update({ ownedPlayers: [] });
  await assert.rejects(
    completeDailyYouthTrainingWithDb(db, uid, player.id, nowMs + 24 * 60 * 60 * 1000 - 1),
    /YOUTH_TRAINING_NOT_FINISHED/,
  );

  const completed = await completeDailyYouthTrainingWithDb(db, uid, player.id, nowMs + 24 * 60 * 60 * 1000);
  assert.equal(completed.success, true);
  const profile = await db.collection('players_v14').doc(uid).get();
  const savedPlayer = profile.get('youthAcademyPlayers')[0];
  assert.equal(savedPlayer.dailyTrainingFinishTime, null);
  assert.equal(savedPlayer.lastYouthTrainingAt, new Date(nowMs + 24 * 60 * 60 * 1000).toISOString());
  assert.equal(profile.get('managerXp'), undefined);
  await assert.rejects(
    completeDailyYouthTrainingWithDb(db, uid, player.id, nowMs + 25 * 60 * 60 * 1000),
    /YOUTH_TRAINING_NOT_IN_PROGRESS/,
  );
});

test('Firestore Emulator promotion enforces age, training and market locks before moving to the first team', {
  skip: !emulatorHost,
}, async t => {
  const db = await withIsolatedFirestore(t);
  const uid = 'youth-promotion-manager-' + randomUUID();
  const nowMs = 1_800_000_000_000;
  const gameYearMs = 7 * 24 * 60 * 60 * 1000;
  const player = generateScoutedPlayer(0, 2, 'promotion-candidate', nowMs);
  player.birthDate = new Date(nowMs - 17 * gameYearMs).toISOString();
  player.baseAge = 17;
  player.age = 17;
  await db.collection('players_v14').doc(uid).set({
    ownedPlayers: [],
    youthAcademyPlayers: [player],
  });

  await assert.rejects(promoteYouthPlayerWithDb(db, uid, player.id, nowMs), /YOUTH_PLAYER_NOT_18/);
  player.birthDate = new Date(nowMs - 18 * gameYearMs).toISOString();
  player.baseAge = 18;
  player.age = 18;
  player.dailyTrainingFinishTime = new Date(nowMs + 60_000).toISOString();
  await db.collection('players_v14').doc(uid).update({ youthAcademyPlayers: [player] });
  await assert.rejects(promoteYouthPlayerWithDb(db, uid, player.id, nowMs), /YOUTH_TRAINING_IN_PROGRESS/);

  player.dailyTrainingFinishTime = null;
  player.transferMarketId = 'active-youth-lot';
  player.onTransferUntil = new Date(nowMs + 60_000).toISOString();
  await db.collection('players_v14').doc(uid).update({ youthAcademyPlayers: [player] });
  await assert.rejects(promoteYouthPlayerWithDb(db, uid, player.id, nowMs), /YOUTH_PLAYER_ON_MARKET/);

  player.transferMarketId = null;
  player.onTransferUntil = null;
  await db.collection('players_v14').doc(uid).update({ youthAcademyPlayers: [player] });
  const promoted = await promoteYouthPlayerWithDb(db, uid, player.id, nowMs);
  assert.equal(promoted.success, true);
  const profile = await db.collection('players_v14').doc(uid).get();
  assert.equal(profile.get('youthAcademyPlayers').length, 0);
  assert.equal(profile.get('ownedPlayers').length, 1);
  assert.equal(profile.get('ownedPlayers')[0].isYouth, false);
  const repeated = await promoteYouthPlayerWithDb(db, uid, player.id, nowMs);
  assert.equal(repeated.alreadyPromoted, true);
});


test('Firestore Emulator keeps first-team daily training on the senior roster', {
  skip: !emulatorHost,
}, async t => {
  const db = await withIsolatedFirestore(t);
  const uid = 'senior-training-manager-' + randomUUID();
  const nowMs = 1_800_000_000_000;
  const player = generateScoutedPlayer(0, 0, 'senior-training-candidate', nowMs);
  player.isYouth = false;
  await db.collection('players_v14').doc(uid).set({
    ownedPlayers: [player],
    youthAcademyPlayers: [],
  });

  const started = await startDailyTrainingWithDb(db, uid, player.id, 'lastHitting', nowMs);
  assert.equal(started.success, true);
  const profile = await db.collection('players_v14').doc(uid).get();
  assert.equal(profile.get('ownedPlayers')[0].dailyTrainingFinishTime, started.finishTime);
  assert.equal(profile.get('youthAcademyPlayers').length, 0);
});


test('Firestore Emulator refuses to recruit a candidate already present in the first-team roster', {
  skip: !emulatorHost,
}, async t => {
  const db = await withIsolatedFirestore(t);
  const uid = 'youth-duplicate-manager-' + randomUUID();
  const nowMs = 1_800_000_000_000;
  const candidate = generateScoutedPlayer(0, 1, 'cross-roster-candidate', nowMs);
  await db.collection('players_v14').doc(uid).set({
    ownedPlayers: [{ ...candidate, isYouth: false }],
    youthAcademyPlayers: [],
    scoutingCandidates: [candidate],
    academy: { youthBootcampLevel: 0 },
  });

  await assert.rejects(recruitYouthCandidateWithDb(db, uid, candidate.id), /PLAYER_ALREADY_IN_FIRST_TEAM/);
  const profile = await db.collection('players_v14').doc(uid).get();
  assert.equal(profile.get('ownedPlayers').length, 1);
  assert.equal(profile.get('youthAcademyPlayers').length, 0);
  assert.equal(profile.get('scoutingCandidates').length, 1);
});
