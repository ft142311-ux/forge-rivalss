import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth as getClientAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore as getClientFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { buildBotClub, isValidBotClub, retireInactiveClub, runClubInactivitySweep } = require('../functions/club-inactivity-sweep.js');
const { recordUserActivityUnlessRetiring } = require('../functions/club-activity-fence.js');
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

test('bot club validator accepts the canonical five-player roster and rejects corruption', () => {
  const botId = 'BOT_ALPHA_L2_G1_R3';
  const bot = buildBotClub(botId, 'Test Bot');
  assert.equal(isValidBotClub(bot, botId), true);

  const missingLineup = structuredClone(bot);
  delete missingLineup.lineup.support;
  assert.equal(isValidBotClub(missingLineup, botId), false);

  const duplicatePlayer = structuredClone(bot);
  duplicatePlayer.ownedPlayers[4].id = duplicatePlayer.ownedPlayers[0].id;
  assert.equal(isValidBotClub(duplicatePlayer, botId), false);

  const invalidRating = structuredClone(bot);
  invalidRating.ownedPlayers[0].overallRating = 0;
  assert.equal(isValidBotClub(invalidRating, botId), false);

  assert.equal(isValidBotClub({ ...bot, id: 'BOT_OTHER' }, botId), false);
});

test('Firestore rules deny a retired account access to its active club data', {
  skip: !emulatorHost || !process.env.FIREBASE_AUTH_EMULATOR_HOST,
}, async (t) => {
  const firestoreHost = emulatorHost.split(':')[0];
  const firestorePort = Number(emulatorHost.split(':')[1]);
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const testProjectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';
  const adminApp = initializeApp({ projectId: testProjectId }, `retired-rules-admin-${randomUUID()}`);
  const adminDb = getFirestore(adminApp);
  const adminAuth = getAuth(adminApp);
  const email = `retired-rules-${randomUUID()}@example.test`;
  const password = 'TestPassword123!';
  const authUser = await adminAuth.createUser({ email, password });
  const uid = authUser.uid;
  const playerRef = adminDb.collection('players_v14').doc(uid);
  const pendingRef = adminDb.collection('inactive_club_retirements_v1').doc(uid);
  const retiredRef = adminDb.collection('inactive_clubs_v1').doc(uid);

  const clientApp = initializeClientApp({
    apiKey: 'fake-api-key',
    authDomain: 'localhost',
    projectId: testProjectId,
  }, `retired-rules-client-${randomUUID()}`);
  const clientAuth = getClientAuth(clientApp);
  const clientDb = getClientFirestore(clientApp);
  connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
  connectFirestoreEmulator(clientDb, firestoreHost, firestorePort);

  t.after(async () => {
    await signOut(clientAuth).catch(() => undefined);
    await playerRef.delete().catch(() => undefined);
    await pendingRef.delete().catch(() => undefined);
    await retiredRef.delete().catch(() => undefined);
    await adminAuth.deleteUser(uid).catch(() => undefined);
    await deleteClientApp(clientApp);
    await deleteApp(adminApp);
  });

  await playerRef.set({ id: uid, clubName: 'Rules Test Club' });
  await signInWithEmailAndPassword(clientAuth, email, password);
  const playerDoc = doc(clientDb, 'players_v14', uid);
  assert.equal((await getDoc(playerDoc)).exists(), true);

  await pendingRef.set({ uid, phase: 'PENDING_AUTH_DISABLE' });
  await assert.rejects(
    getDoc(playerDoc),
    (error) => error && error.code === 'permission-denied',
  );

  await pendingRef.delete();
  await retiredRef.set({ uid, retiredAt: new Date() });
  await assert.rejects(
    getDoc(playerDoc),
    (error) => error && error.code === 'permission-denied',
  );
});

test('login activity handshake is blocked once retirement has been claimed', {
  skip: !emulatorHost,
}, async (t) => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  const testProjectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';
  const app = initializeApp({ projectId: testProjectId }, `activity-fence-test-${randomUUID()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const email = `activity-fence-${randomUUID()}@example.test`;
  const password = 'TestPassword123!';
  const authUser = await auth.createUser({ email, password });
  const uid = authUser.uid;

  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(authHost, 'Auth Emulator must be enabled for this integration test');
  const signInUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`;
  const initialLogin = await fetch(signInUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(initialLogin.status, 200, 'password login works before account retirement');
  await auth.updateUser(uid, { disabled: true });
  const disabledLogin = await fetch(signInUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(disabledLogin.status, 400, 'password login is rejected for disabled accounts');
  const disabledLoginBody = await disabledLogin.json();
  assert.match(String(disabledLoginBody.error?.message || ''), /USER_DISABLED/);
  await auth.updateUser(uid, { disabled: false });
  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const retiredRef = db.collection('inactive_clubs_v1').doc(uid);
  const activityRef = db.collection('user_activity_v1').doc(uid);

  t.after(async () => {
    await pendingRef.delete().catch(() => undefined);
    await retiredRef.delete().catch(() => undefined);
    await activityRef.delete().catch(() => undefined);
    await auth.deleteUser(uid).catch(() => undefined);
    await deleteApp(app);
  });

  await activityRef.set({
    uid,
    lastActiveAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
  });
  const first = await recordUserActivityUnlessRetiring(db, uid);
  assert.deepEqual(first, { success: true });
  const before = await activityRef.get();
  assert.equal(before.exists, true);
  const beforeMillis = before.get('lastActiveAt')?.toMillis?.();
  assert.ok(Number.isFinite(beforeMillis));

  const now = new Date();
  const staleAuthRecord = {
    ...authUser,
    disabled: false,
    metadata: {
      ...authUser.metadata,
      lastSignInTime: new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString(),
    },
  };
  const authWithStaleMetadata = {
    getUser: async () => staleAuthRecord,
    updateUser: (...args) => auth.updateUser(...args),
    revokeRefreshTokens: (...args) => auth.revokeRefreshTokens(...args),
  };
  const retirementAttempt = await retireInactiveClub({
    db,
    auth: authWithStaleMetadata,
    userRecord: staleAuthRecord,
    now,
  });
  assert.equal(retirementAttempt.action, 'SKIPPED_NOT_INACTIVE');
  assert.equal((await auth.getUser(uid)).disabled, false);

  await pendingRef.set({ uid, phase: 'PENDING_AUTH_DISABLE', requestedAt: new Date() });
  const blocked = await recordUserActivityUnlessRetiring(db, uid);
  assert.deepEqual(blocked, { success: false, error: 'ACCOUNT_RETIRING' });

  const conflictingWorker = await retireInactiveClub({
    db,
    auth: authWithStaleMetadata,
    userRecord: staleAuthRecord,
    now,
  });
  assert.equal(conflictingWorker.action, 'CANCELLED_PENDING_CLEANUP');
  assert.equal((await pendingRef.get()).exists, false);

  await pendingRef.set({ uid, phase: 'REVIEW_REQUIRED', requestedAt: new Date() });
  const skippedReview = await retireInactiveClub({
    db,
    auth: authWithStaleMetadata,
    userRecord: staleAuthRecord,
    now,
  });
  assert.equal(skippedReview.action, 'SKIPPED_REVIEW_REQUIRED');

  const after = await activityRef.get();
  assert.equal(after.get('lastActiveAt')?.toMillis?.(), beforeMillis);

  await pendingRef.delete();
  await retiredRef.set({ uid, retiredAt: new Date() });
  const permanentlyBlocked = await recordUserActivityUnlessRetiring(db, uid);
  assert.deepEqual(permanentlyBlocked, { success: false, error: 'ACCOUNT_RETIRED' });

  await retiredRef.delete();
  await pendingRef.set({ uid, phase: 'CANCELLED', cancellationReason: 'DEFERRED_MATCH_PROCESSING' });
  await auth.updateUser(uid, { disabled: true });
  const cancelledFence = await recordUserActivityUnlessRetiring(db, uid);
  assert.deepEqual(cancelledFence, { success: false, error: 'ACCOUNT_RETIRING' });
  assert.equal((await pendingRef.get()).get('phase'), 'CANCELLED');
  const cancelledRecovery = await retireInactiveClub({
    db,
    auth,
    userRecord: { ...authUser, disabled: true, metadata: authUser.metadata },
    now,
  });
  assert.equal(cancelledRecovery.action, 'CANCELLED_PENDING_CLEANUP');
  assert.equal((await auth.getUser(uid)).disabled, false);
  assert.equal((await pendingRef.get()).exists, false);

  // A pending claim must be resumed even when the Auth sign-in timestamp is
  // recent; otherwise a crash during race cancellation could leave the login
  // fence in place forever because the account is not a 90-day candidate.
  await pendingRef.set({
    uid,
    phase: 'PENDING_AUTH_DISABLE',
    leaseOwner: 'crashed-worker',
    leaseUntil: new Date(Date.now() - 60 * 1000),
    attempts: 1,
  });
  const sweepAuth = {
    getUser: (...args) => auth.getUser(...args),
    listUsers: async (_pageSize, pageToken) => ({
      users: pageToken ? [] : [await auth.getUser(uid)],
      pageToken: undefined,
    }),
  };
  const sweep = await runClubInactivitySweep({ db, auth: sweepAuth, now: new Date() });
  assert.equal(sweep.pendingOperationsScanned, 1);
  assert.equal(sweep.recoveredCancellations, 1);
  assert.equal((await pendingRef.get()).exists, false);
  assert.equal((await auth.getUser(uid)).disabled, false);
});

test('inactive club replacement is atomic and preserves completed match results', {
  skip: !emulatorHost,
}, async (t) => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');

  const testProjectId = `demo-inact-${randomUUID().slice(0, 8)}`;
  const app = initializeApp({ projectId: testProjectId }, `inactive-club-test-${randomUUID()}`);
  const db = getFirestore(app);
  const uid = `inactive-test-${randomUUID()}`;
  const season = 99;
  const division = 2;
  const group = 1;
  const rank = 3;
  const botId = `BOT_ALPHA_L${division}_G${group}_R${rank}`;
  const now = new Date('2026-11-13T12:00:00.000Z');
  const lastSignInTime = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const playerRef = db.collection('players_v14').doc(uid);
  const slotRef = db.collection('league_slots_v1').doc(`test_${uid}`);
  const historyRef = db.collection('league_slot_history_v1').doc(`${slotRef.id}_G1`);
  const tableRef = db.collection('league_tables_v2').doc(`table_v140_S${season}_LALPHA_V${division}_G${group}`);
  const archiveRef = db.collection('inactive_clubs_v1').doc(uid);
  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const configRef = db.collection('system_v1').doc('season_config');
  const matchRefs = [];
  const botRef = db.collection('players_v14').doc(botId);

  t.after(async () => {
    await playerRef.delete().catch(() => undefined);
    await slotRef.delete().catch(() => undefined);
    await historyRef.delete().catch(() => undefined);
    await tableRef.delete().catch(() => undefined);
    await archiveRef.delete().catch(() => undefined);
    await pendingRef.delete().catch(() => undefined);
    await botRef.delete().catch(() => undefined);
    await configRef.delete().catch(() => undefined);
    for (const ref of matchRefs) await ref.delete().catch(() => undefined);
    await deleteApp(app);
  });

  const player = {
    id: uid, clubName: 'Inactive Test Club', selectedLeagueId: 'ALPHA',
    lastProcessedSeason: season - 1, leagueLevel: division, groupId: group, rank,
    ownedPlayers: [{ id: 'test-player' }],
  };
  await configRef.set({
    activeSeasonNumber: season,
    phase: 'REGULAR_SEASON',
    worldReady: true,
  });
  await playerRef.set(player);
  await slotRef.set({
    season, leagueId: 'ALPHA', division, group, rank,
    status: 'OCCUPIED', occupantId: uid,
  });
  await tableRef.set({
    season, leagueId: 'ALPHA', level: division, group,
    stats: {
      [uid]: {
        id: uid, name: player.clubName, rank,
        matchesPlayed: 4, wins: 3, draws: 0, losses: 1, points: 9, diff: 5, isBot: false,
      },
    },
  });

  for (let i = 0; i < 56; i++) {
    const ref = db.collection('matches_v2').doc(`inactive_${uid}_${i}`);
    matchRefs.push(ref);
    await ref.set({
      season, leagueId: 'ALPHA', level: division, groupId: group,
      version: 140, type: 'league',
      homeId: i === 0 || i === 2 ? uid : `opponent_${i}`,
      homeName: i === 0 || i === 2 ? player.clubName : `Opponent ${i}`,
      awayId: i === 1 ? uid : `away_${i}`,
      awayName: i === 1 ? player.clubName : `Away ${i}`,
      homeLogo: i === 2 ? 'old-club-home-logo' : null,
      awayLogo: i === 1 ? 'old-club-away-logo' : null,
      homeRank: i === 0 ? rank : 1,
      awayRank: i === 1 ? rank : 2,
      // A due fixture for unrelated teams must not block this user's retirement.
      startTime: i === 3
        ? new Date(now.getTime() - 60 * 60 * 1000).toISOString()
        : new Date(now.getTime() + (i + 1) * 60 * 60 * 1000).toISOString(),
      isFinished: i === 0,
      status: i === 0 ? 'finished' : 'scheduled',
      isProcessing: false,
      scoreA: i === 0 ? 2 : 0,
      scoreB: i === 0 ? 1 : 0,
    });
  }

  let disabled = false;
  let revokedTokenCalls = 0;
  const auth = {
    getUser: async () => ({ uid, disabled, metadata: { lastSignInTime } }),
    updateUser: async (_uid, patch) => { disabled = patch.disabled; return { uid, disabled }; },
    revokeRefreshTokens: async () => { revokedTokenCalls++; },
  };
  const userRecord = { uid, disabled: false, metadata: { lastSignInTime } };

  await pendingRef.set({
    uid,
    phase: 'PENDING_AUTH_DISABLE',
    leaseOwner: 'other-worker',
    leaseUntil: new Date(now.getTime() + 5 * 60 * 1000),
    attempts: 1,
  });
  const concurrentAttempt = await retireInactiveClub({ db, auth, userRecord, now });
  assert.equal(concurrentAttempt.action, 'SKIPPED_RETIREMENT_IN_PROGRESS');
  assert.equal(disabled, false);
  await pendingRef.set({
    uid,
    phase: 'UNRECOGNIZED_PHASE',
    leaseOwner: 'old-worker',
    leaseUntil: new Date(now.getTime() - 60 * 1000),
    attempts: 1,
  });
  const unknownPhase = await retireInactiveClub({ db, auth, userRecord, now });
  assert.equal(unknownPhase.action, 'SKIPPED_REVIEW_REQUIRED');
  assert.equal((await pendingRef.get()).get('phase'), 'REVIEW_REQUIRED');
  assert.equal(disabled, false);
  await pendingRef.delete();

  let authReads = 0;
  const recentSignInTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const loginRaceAuth = {
    ...auth,
    getUser: async () => {
      authReads++;
      return {
        uid,
        disabled,
        metadata: { lastSignInTime: authReads === 1 ? lastSignInTime : recentSignInTime },
      };
    },
  };
  const loginRace = await retireInactiveClub({ db, auth: loginRaceAuth, userRecord, now });
  assert.equal(loginRace.action, 'SKIPPED_ACTIVITY_RACE');
  assert.equal(disabled, false);
  assert.equal((await pendingRef.get()).exists, false);

  await pendingRef.set({
    uid,
    phase: 'PENDING_AUTH_DISABLE',
    leaseOwner: 'expired-worker',
    leaseUntil: new Date(now.getTime() - 60 * 1000),
    attempts: 1,
  });

  const authDisableFailure = {
    ...auth,
    updateUser: async () => { throw new Error('SIMULATED_AUTH_DISABLE_FAILURE'); },
  };
  await assert.rejects(
    retireInactiveClub({ db, auth: authDisableFailure, userRecord, now }),
    /SIMULATED_AUTH_DISABLE_FAILURE/,
  );
  assert.equal(disabled, false);
  assert.equal((await pendingRef.get()).get('phase'), 'PENDING_AUTH_DISABLE');

  const afterDisableFailure = new Date(now.getTime() + 11 * 60 * 1000);
  const tokenRevokeFailure = {
    ...auth,
    revokeRefreshTokens: async () => { throw new Error('SIMULATED_TOKEN_REVOCATION_FAILURE'); },
  };
  await assert.rejects(
    retireInactiveClub({ db, auth: tokenRevokeFailure, userRecord, now: afterDisableFailure }),
    /SIMULATED_TOKEN_REVOCATION_FAILURE/,
  );
  assert.equal(disabled, true);
  assert.equal((await pendingRef.get()).get('phase'), 'PENDING_AUTH_DISABLE');

  const recoveryNow = new Date(now.getTime() + 22 * 60 * 1000);
  const result = await retireInactiveClub({ db, auth, userRecord, now: recoveryNow });
  assert.equal(result.action, 'RETIRED_AND_REPLACED');
  assert.equal(disabled, true);
  assert.equal(revokedTokenCalls, 1);
  assert.equal((await playerRef.get()).exists, false);
  assert.equal((await pendingRef.get()).exists, false);
  const archivedClub = (await archiveRef.get()).data();
  assert.equal(archivedClub.replacedByBotId, botId);
  assert.equal(archivedClub.lastSignInAt, lastSignInTime);
  assert.ok(Number.isFinite(Date.parse(archivedClub.lastActiveAt)));
  const releasedSlot = await slotRef.get();
  assert.equal(releasedSlot.get('status'), 'FREE');
  assert.equal(releasedSlot.get('occupantId'), null);
  assert.equal(releasedSlot.get('occupancyGeneration'), 1);
  assert.equal(releasedSlot.get('lastOccupantId'), uid);
  const history = await historyRef.get();
  assert.equal(history.exists, true);
  assert.equal(history.get('reason'), 'INACTIVITY_RETIREMENT');
  assert.equal(history.get('previousOccupantId'), uid);
  assert.equal(history.get('newOccupantId'), botId);
  assert.equal(history.get('generation'), 1);

  const table = (await tableRef.get()).data();
  assert.equal(table.stats[botId].isBot, true);
  assert.equal(table.stats[botId].points, 9);
  assert.equal(table.stats[uid], undefined);

  const bot = (await botRef.get()).data();
  assert.equal(bot.isBot, true);
  assert.equal(bot.ownedPlayers.length, 5);

  const completed = (await matchRefs[0].get()).data();
  assert.equal(completed.homeId, uid);
  assert.equal(completed.homeName, player.clubName);
  assert.equal(completed.scoreA, 2);
  const future = (await matchRefs[2].get()).data();
  assert.equal(future.homeId, botId);
  assert.equal(future.homeName, 'Bot01200103');
  const futureAway = (await matchRefs[1].get()).data();
  assert.equal(futureAway.awayId, botId);
  assert.equal(futureAway.awayName, 'Bot01200103');
});


test('a pending retirement with recent activity is safely cancelled and Auth access restored', {
  skip: !emulatorHost,
}, async (t) => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  const testProjectId = `demo-recov-${randomUUID().slice(0, 8)}`;
  const app = initializeApp({ projectId: testProjectId }, `inactive-recovery-test-${randomUUID()}`);
  const db = getFirestore(app);
  const uid = `inactive-recovery-${randomUUID()}`;
  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const activityRef = db.collection('user_activity_v1').doc(uid);
  const now = new Date('2026-11-14T12:00:00.000Z');
  const lastSignInTime = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();

  t.after(async () => {
    await pendingRef.delete().catch(() => undefined);
    await activityRef.delete().catch(() => undefined);
    await deleteApp(app);
  });

  await pendingRef.set({
    uid,
    phase: 'PENDING_AUTH_DISABLE',
    leaseOwner: 'active-retirement-worker',
    leaseUntil: new Date(now.getTime() + 5 * 60 * 1000),
    requestedAt: now,
  });
  await activityRef.set({
    uid,
    lastActiveAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  });

  let disabled = true;
  const auth = {
    getUser: async () => ({ uid, disabled, metadata: { lastSignInTime } }),
    updateUser: async (_uid, patch) => { disabled = patch.disabled; return { uid, disabled }; },
    revokeRefreshTokens: async () => undefined,
  };

  const userRecord = { uid, disabled: true, metadata: { lastSignInTime } };
  const activeLease = await retireInactiveClub({ db, auth, userRecord, now });
  assert.equal(activeLease.action, 'SKIPPED_RETIREMENT_IN_PROGRESS');
  assert.equal(disabled, true);
  assert.equal((await pendingRef.get()).get('phase'), 'PENDING_AUTH_DISABLE');

  const result = await retireInactiveClub({
    db,
    auth,
    userRecord,
    now: new Date(now.getTime() + 6 * 60 * 1000),
  });

  assert.equal(result.action, 'CANCELLED_PENDING_CLEANUP');
  assert.equal(disabled, false);
  assert.equal((await pendingRef.get()).exists, false);

  await pendingRef.set({ uid, phase: 'UNRECOGNIZED_PHASE', requestedAt: now });
  const unknownPhase = await retireInactiveClub({
    db,
    auth,
    userRecord,
    now: new Date(now.getTime() + 7 * 60 * 1000),
  });
  assert.equal(unknownPhase.action, 'SKIPPED_REVIEW_REQUIRED');
  assert.equal((await pendingRef.get()).get('phase'), 'REVIEW_REQUIRED');
});
