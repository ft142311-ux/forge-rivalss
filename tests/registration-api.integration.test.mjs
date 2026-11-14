import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const require = createRequire(import.meta.url);
const { retireInactiveClub } = require('../functions/club-inactivity-sweep.js');

test('registration HTTP API enforces its boundary and safely initializes a club', {
  skip: !firestoreHost || !authHost,
}, async (t) => {
  assert.match(firestoreHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.match(authHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';
  assert.equal(projectId, 'demo-forge-rivals');

  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
  const app = initializeApp({ projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const { POST } = await import('../src/app/api/registration/initialize/route.ts');

  await t.test('rejects unsupported content types before authentication', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'ignored',
    }));
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  });

  await t.test('rejects requests without a bearer token', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubName: 'Test Club' }),
    }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'AUTHENTICATION_REQUIRED');
  });

  await t.test('rejects malformed bearer tokens using Auth Emulator verification', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer definitely-not-a-valid-firebase-id-token',
      },
      body: JSON.stringify({ clubName: 'Test Club' }),
    }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'AUTH_TOKEN_INVALID');
  });

  await t.test('rejects oversized request bodies', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '5000',
      },
      body: JSON.stringify({ clubName: 'Test Club' }),
    }));
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'REQUEST_TOO_LARGE');
  });

  await t.test('creates one club, replaces its bot and remains idempotent on retry', async (t) => {
    const runId = randomUUID();
    const season = 701;
    const group = 8;
    const division = 4;
    const botId = `api-test-bot-${runId}`;
    const email = `registration-${runId}@example.test`;
    const password = `Test-${randomUUID()}-Aa1!`;
    const user = await auth.createUser({ email, password, emailVerified: true });
    const uid = user.uid;
    const slotRefs = [];
    const matchRefs = [];
    const historyRefs = [];
    const auditQuery = db.collection('security_audit_v1').where('actorUid', '==', uid);
    const tableRef = db.collection('league_tables_v2')
      .doc(`table_v140_S${season}_LALPHA_V${division}_G${group}`);
    const configRef = db.collection('system_v1').doc('season_config');
    const statsRef = db.collection('system_v1').doc('global_stats');
    const playerRef = db.collection('players_v14').doc(uid);
    const activityRef = db.collection('user_activity_v1').doc(uid);
    const archiveRef = db.collection('inactive_clubs_v1').doc(uid);
    const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
    const replacementBotId = `BOT_ALPHA_L${division}_G${group}_R8`;
    const replacementBotRef = db.collection('players_v14').doc(replacementBotId);
    let retirementHistoryRef;
    const botPlayerRef = db.collection('players_v14').doc(botId);
    let replacementUid = null;
    let replacementPlayerRef = null;
    let replacementActivityRef = null;
    let replacementAuditQuery = null;
    let contenderUidsForCleanup = [];

    t.after(async () => {
      const auditSnapshot = await auditQuery.get();
      const cleanupRefs = [
        ...slotRefs,
        ...matchRefs,
        ...historyRefs,
        ...auditSnapshot.docs.map((doc) => doc.ref),
        tableRef,
        configRef,
        statsRef,
        playerRef,
        activityRef,
        archiveRef,
        pendingRef,
        replacementBotRef,
        ...(retirementHistoryRef ? [retirementHistoryRef] : []),
        ...(replacementPlayerRef ? [replacementPlayerRef] : []),
        ...(replacementActivityRef ? [replacementActivityRef] : []),
        ...(replacementAuditQuery ? (await replacementAuditQuery.get()).docs.map((doc) => doc.ref) : []),
        ...contenderUidsForCleanup.flatMap((contenderUid) => [
          db.collection('players_v14').doc(contenderUid),
          db.collection('user_activity_v1').doc(contenderUid),
          db.collection('inactive_clubs_v1').doc(contenderUid),
          db.collection('inactive_club_retirements_v1').doc(contenderUid),
        ]),
        ...(await Promise.all(contenderUidsForCleanup.map((contenderUid) =>
          db.collection('security_audit_v1').where('actorUid', '==', contenderUid).get()
        ))).flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref)),
        botPlayerRef,
      ];
      for (let i = 0; i < cleanupRefs.length; i += 400) {
        const batch = db.batch();
        for (const ref of cleanupRefs.slice(i, i + 400)) batch.delete(ref);
        await batch.commit();
      }
      await auth.deleteUser(uid).catch(() => undefined);
      for (const contenderUid of contenderUidsForCleanup) {
        await auth.deleteUser(contenderUid).catch(() => undefined);
      }
      if (replacementUid) await auth.deleteUser(replacementUid).catch(() => undefined);
      await deleteApp(app);
    });

    await configRef.set({
      activeSeasonNumber: season,
      phase: 'REGULAR_SEASON',
      worldReady: true,
    });
    await statsRef.set({ totalPlayers: 1000 });
    const targetSlotId = `${runId}-slot-${division}-${group}-8`;
    const historyRef = db.collection('league_slot_history_v1').doc(`${targetSlotId}_G8`);
    retirementHistoryRef = db.collection('league_slot_history_v1').doc(`${targetSlotId}_G9`);
    historyRefs.push(historyRef, retirementHistoryRef);

    const tableStats = {};
    for (let rank = 1; rank <= 8; rank += 1) {
      const id = rank === 8 ? botId : `api-test-team-${rank}-${runId}`;
      tableStats[id] = {
        id,
        name: rank === 8 ? 'Test Bot' : `Test Team ${rank}`,
        rank,
        isBot: rank === 8,
        matchesPlayed: rank === 8 ? 4 : 0,
        wins: rank === 8 ? 3 : 0,
        draws: 0,
        losses: rank === 8 ? 1 : 0,
        points: rank === 8 ? 9 : 0,
        diff: rank === 8 ? 5 : 0,
      };
    }
    await tableRef.set({
      season,
      leagueId: 'ALPHA',
      level: division,
      group,
      stats: tableStats,
    });
    await botPlayerRef.set({
      id: botId,
      clubName: 'Test Bot',
      isBot: true,
      ownedPlayers: Array.from({ length: 5 }, (_, index) => ({ id: `bot-player-${index + 1}` })),
    });

    for (let divisionNumber = 1; divisionNumber <= 4; divisionNumber += 1) {
      const groups = divisionNumber === 1 ? 1 : divisionNumber === 2 ? 2 : divisionNumber === 3 ? 4 : 8;
      for (let groupNumber = 1; groupNumber <= groups; groupNumber += 1) {
        for (let rank = 1; rank <= 8; rank += 1) {
          const isTarget = divisionNumber === division && groupNumber === group && rank === 8;
          const ref = db.collection('league_slots_v1').doc(`${runId}-slot-${divisionNumber}-${groupNumber}-${rank}`);
          slotRefs.push(ref);
          await ref.set({
            season,
            leagueId: 'ALPHA',
            division: divisionNumber,
            group: groupNumber,
            rank,
            status: isTarget ? 'FREE' : 'OCCUPIED',
            occupantId: isTarget ? null : `occupied-${divisionNumber}-${groupNumber}-${rank}`,
            occupancyGeneration: isTarget ? 7 : 0,
          });
        }
      }
    }

    for (let homeRank = 1; homeRank <= 8; homeRank += 1) {
      for (let awayRank = 1; awayRank <= 8; awayRank += 1) {
        if (homeRank === awayRank) continue;
        const homeId = homeRank === 8 ? botId : `api-test-team-${homeRank}-${runId}`;
        const awayId = awayRank === 8 ? botId : `api-test-team-${awayRank}-${runId}`;
        const ref = db.collection('matches_v2').doc(`${runId}-match-${homeRank}-${awayRank}`);
        matchRefs.push(ref);
        await ref.set({
          season,
          leagueId: 'ALPHA',
          level: division,
          groupId: group,
          version: 140,
          homeId,
          awayId,
          homeName: homeRank === 8 ? 'Test Bot' : `Test Team ${homeRank}`,
          awayName: awayRank === 8 ? 'Test Bot' : `Test Team ${awayRank}`,
          homeLogo: homeRank === 8 ? 'bot-logo' : null,
          awayLogo: awayRank === 8 ? 'bot-logo' : null,
          homeRank,
          awayRank,
          isFinished: homeRank === 8 && awayRank === 1,
          status: homeRank === 8 && awayRank === 1 ? 'finished' : 'scheduled',
          startTime: homeRank === 8 && awayRank === 1
            ? '2026-10-01T12:00:00.000Z'
            : homeRank === 1 && awayRank === 2
              ? '2020-01-01T00:00:00.000Z'
              : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          scoreA: homeRank === 8 && awayRank === 1 ? 2 : 0,
          scoreB: homeRank === 8 && awayRank === 1 ? 1 : 0,
        });
      }
    }

    const signIn = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    assert.equal(signIn.status, 200, 'Auth Emulator should issue an ID token');
    const { idToken, refreshToken } = await signIn.json();
    assert.equal(typeof idToken, 'string');
    assert.equal(typeof refreshToken, 'string');

    const request = () => POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ clubName: 'Forge Test Club' }),
    }));

    // A standings row alone is not enough to replace a bot. The backing
    // player document must exist and be a valid five-player bot profile.
    const validBotProfile = (await botPlayerRef.get()).data();
    await botPlayerRef.set({ ...validBotProfile, isBot: false });
    const invalidBotResponse = await request();
    const invalidBotBody = await invalidBotResponse.json();
    assert.equal(invalidBotResponse.status, 503);
    assert.equal(invalidBotBody.error, 'BOT_PLAYER_INVALID');
    assert.equal((await playerRef.get()).exists, false);
    assert.equal((await db.collection('league_slots_v1').doc(targetSlotId).get()).get('status'), 'FREE');
    await botPlayerRef.set(validBotProfile);

    // Two simultaneous requests from the same authenticated UID must
    // converge on one player document and one slot allocation.
    const [firstResponse, simultaneousRetryResponse] = await Promise.all([request(), request()]);
    const [firstBody, simultaneousRetryBody] = await Promise.all([
      firstResponse.json(),
      simultaneousRetryResponse.json(),
    ]);
    assert.equal(firstResponse.status, 200, JSON.stringify(firstBody));
    assert.equal(simultaneousRetryResponse.status, 200, JSON.stringify(simultaneousRetryBody));
    const createdRegistration = firstBody.alreadyInitialized === false
      ? { response: firstResponse, body: firstBody }
      : { response: simultaneousRetryResponse, body: simultaneousRetryBody };
    const idempotentRegistration = firstBody.alreadyInitialized === true
      ? { response: firstResponse, body: firstBody }
      : { response: simultaneousRetryResponse, body: simultaneousRetryBody };
    assert.equal(createdRegistration.body.success, true);
    assert.equal(createdRegistration.body.alreadyInitialized, false);
    assert.equal(idempotentRegistration.body.success, true);
    assert.equal(idempotentRegistration.body.alreadyInitialized, true);
    assert.equal(idempotentRegistration.body.numericId, createdRegistration.body.numericId);
    const response = createdRegistration.response;
    const responseBody = createdRegistration.body;
    assert.equal(responseBody.clubName, 'Forge Test Club');
    assert.equal(responseBody.tier, division);
    assert.equal(responseBody.group, group);
    assert.equal(responseBody.rank, 8);

    const [player, botPlayer, table, slotQuery, matches, stats, audit] = await Promise.all([
      playerRef.get(),
      botPlayerRef.get(),
      tableRef.get(),
      db.collection('league_slots_v1').where('season', '==', season).get(),
      db.collection('matches_v2').where('season', '==', season).get(),
      statsRef.get(),
      auditQuery.get(),
    ]);

    assert.equal(player.exists, true);
    assert.equal(player.get('ownedPlayers').length, 10);
    assert.equal(botPlayer.exists, false);
    assert.equal(table.get(`stats.${uid}.rank`), 8);
    assert.equal(table.get(`stats.${uid}.isBot`), false);
    assert.equal(table.get(`stats.${uid}.matchesPlayed`), 4);
    assert.equal(table.get(`stats.${uid}.wins`), 3);
    assert.equal(table.get(`stats.${uid}.losses`), 1);
    assert.equal(table.get(`stats.${uid}.points`), 9);
    assert.equal(table.get(`stats.${uid}.diff`), 5);
    assert.equal(table.get(`stats.${botId}`), undefined);
    const claimedSlot = slotQuery.docs.find((doc) => doc.get('rank') === 8 &&
      doc.get('division') === division && doc.get('group') === group);
    assert.ok(claimedSlot);
    assert.equal(claimedSlot.get('status'), 'OCCUPIED');
    assert.equal(claimedSlot.get('occupantId'), uid);
    assert.equal(claimedSlot.get('occupancyGeneration'), 8);
    const history = await historyRef.get();
    assert.equal(history.exists, true);
    assert.equal(history.get('reason'), 'NEW_REGISTRATION');
    assert.equal(history.get('previousOccupantId'), botId);
    assert.equal(history.get('previousClubSnapshot').clubName, 'Test Bot');
    assert.equal(history.get('previousClubSnapshot').ownedPlayers.length, 5);
    assert.equal(history.get('newOccupantId'), uid);
    assert.equal(history.get('generation'), 8);
    assert.equal(matches.size, 56);
    assert.equal(matches.docs.filter((doc) =>
      doc.get('homeId') === uid || doc.get('awayId') === uid
    ).length, 13);
    const historicalBotMatch = matches.docs.find((doc) =>
      doc.get('homeRank') === 8 && doc.get('awayRank') === 1
    );
    assert.ok(historicalBotMatch);
    assert.equal(historicalBotMatch.get('status'), 'finished');
    assert.equal(historicalBotMatch.get('homeId'), botId);
    assert.equal(historicalBotMatch.get('homeLogo'), 'bot-logo');
    assert.equal(historicalBotMatch.get('scoreA'), 2);
    assert.equal(historicalBotMatch.get('scoreB'), 1);
    const futureBotFixture = matches.docs.find((doc) =>
      doc.get('homeRank') === 8 && doc.get('awayRank') === 2
    );
    assert.ok(futureBotFixture);
    assert.equal(futureBotFixture.get('homeId'), uid);
    assert.equal(futureBotFixture.get('homeLogo'), null);
    assert.equal(matches.docs.filter((doc) =>
      doc.get('homeId') === botId || doc.get('awayId') === botId
    ).length, 1);
    assert.equal(stats.get('totalPlayers'), 1001);
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].get('event'), 'CLUB_REGISTRATION_COMPLETED');

    // Simulate an ambiguous network outcome: the server commits a retry-safe
    // request, but the client discards the response before it can observe it.
    await request();
    const retryAfterLostResponse = await request();
    const retryBody = await retryAfterLostResponse.json();
    assert.equal(retryAfterLostResponse.status, 200);
    assert.equal(retryBody.alreadyInitialized, true);
    assert.equal(retryBody.numericId, responseBody.numericId);

    const [afterRetryStats, afterRetryAudit, afterRetrySlots] = await Promise.all([
      statsRef.get(),
      auditQuery.get(),
      db.collection('league_slots_v1').where('season', '==', season).get(),
    ]);
    assert.equal(afterRetryStats.get('totalPlayers'), 1001);
    assert.equal(afterRetryAudit.size, 1);
    assert.equal(afterRetrySlots.docs.filter((doc) => doc.get('occupantId') === uid).length, 1);

    // Retire the original owner through the real inactivity saga, then prove
    // that the same slot can be claimed by a new account without rewriting
    // the former owner's archive or any completed fixture.
    const completedMatchRef = db.collection('matches_v2').doc(`${runId}-match-8-1`);
    const completedMatchBefore = (await completedMatchRef.get()).data();
    const inactiveSince = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    // The registration handshake records a fresh activity timestamp; age it
    // beyond the retirement threshold to model a genuinely abandoned account.
    await activityRef.set({ uid, lastActiveAt: inactiveSince });
    const actualAuthRecord = await auth.getUser(uid);
    const retirementAuth = {
      getUser: async (targetUid) => {
        const record = await auth.getUser(targetUid);
        return {
          ...record,
          metadata: { ...record.metadata, lastSignInTime: inactiveSince },
        };
      },
      updateUser: (...args) => auth.updateUser(...args),
      revokeRefreshTokens: (...args) => auth.revokeRefreshTokens(...args),
    };
    const retirement = await retireInactiveClub({
      db,
      auth: retirementAuth,
      userRecord: {
        ...actualAuthRecord,
        metadata: { ...actualAuthRecord.metadata, lastSignInTime: inactiveSince },
      },
      now: new Date(),
    });
    assert.equal(retirement.action, 'RETIRED_AND_REPLACED');
    assert.equal(retirement.botId, replacementBotId);
    assert.equal((await auth.getUser(uid)).disabled, true);
    assert.equal((await playerRef.get()).exists, false);
    const archivedBeforeReclaim = (await archiveRef.get()).data();
    assert.equal(archivedBeforeReclaim.replacedByBotId, replacementBotId);
    assert.equal(archivedBeforeReclaim.clubSnapshot.clubName, 'Forge Test Club');
    assert.equal((await retirementHistoryRef.get()).get('reason'), 'INACTIVITY_RETIREMENT');

    const oldPasswordLogin = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    assert.equal(oldPasswordLogin.status, 400, 'retired owner cannot sign in with the old password');
    const oldPasswordError = await oldPasswordLogin.json();
    assert.match(String(oldPasswordError.error?.message || ''), /USER_DISABLED/i);

    const oldRefresh = await fetch(
      `http://${authHost}/securetoken.googleapis.com/v1/token?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      },
    );
    assert.equal(oldRefresh.status, 400, 'retirement revokes previously issued refresh tokens');
    const oldRefreshError = await oldRefresh.json();
    assert.match(
      String(oldRefreshError.error?.message || ''),
      /TOKEN_EXPIRED|INVALID_GRANT|USER_DISABLED|TOKEN_REVOKED/i,
    );

    // A previously issued ID token must also fail server-side revocation
    // verification; the old owner cannot keep using an already-open session.
    const retiredOwnerRequest = await request();
    const retiredOwnerBody = await retiredOwnerRequest.json();
    assert.equal(retiredOwnerRequest.status, 401, JSON.stringify(retiredOwnerBody));
    assert.ok(
      ['ACCOUNT_DISABLED', 'AUTH_TOKEN_REVOKED'].includes(retiredOwnerBody.error),
      `unexpected retired-token response: ${retiredOwnerBody.error}`,
    );

    const releasedSlot = (await db.collection('league_slots_v1')
      .doc(targetSlotId).get()).data();
    assert.equal(releasedSlot.status, 'FREE');
    assert.equal(releasedSlot.occupantId, null);
    assert.equal(releasedSlot.occupancyGeneration, 9);
    const botStanding = (await tableRef.get()).get(`stats.${replacementBotId}`);
    assert.equal(botStanding.isBot, true);
    assert.equal(botStanding.matchesPlayed, 4);
    assert.equal(botStanding.wins, 3);
    assert.equal(botStanding.points, 9);
    assert.equal((await replacementBotRef.get()).get('ownedPlayers').length, 5);

    // Race two genuinely independent accounts for the single released slot.
    // Exactly one transaction may win; the loser must not create a player,
    // standings row, history event, audit event, or increment global totals.
    const contenders = await Promise.all([1, 2].map(async (number) => {
      const email = `replacement-${number}-${runId}@example.test`;
      const password = `Replacement-${randomUUID()}-Bb2!`;
      const user = await auth.createUser({ email, password, emailVerified: true });
      const login = await fetch(
        `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      );
      assert.equal(login.status, 200);
      const tokens = await login.json();
      return { uid: user.uid, email, password, idToken: tokens.idToken };
    }));
    contenderUidsForCleanup = contenders.map(({ uid }) => uid);
    const contenderPlayerRefs = contenders.map(({ uid }) => db.collection('players_v14').doc(uid));
    const contenderActivityRefs = contenders.map(({ uid }) => db.collection('user_activity_v1').doc(uid));
    const contenderAuditQueries = contenders.map(({ uid }) =>
      db.collection('security_audit_v1').where('actorUid', '==', uid)
    );
    const contenderResponses = await Promise.all(contenders.map(({ idToken }) =>
      POST(new Request('http://localhost/api/registration/initialize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ clubName: 'Replacement Club' }),
      }))
    ));
    const contenderBodies = await Promise.all(contenderResponses.map((response) => response.json()));
    const winners = contenderResponses
      .map((response, index) => ({ response, body: contenderBodies[index], contender: contenders[index] }))
      .filter((entry) => entry.response.status === 200);
    const losers = contenderResponses
      .map((response, index) => ({ response, body: contenderBodies[index], contender: contenders[index] }))
      .filter((entry) => entry.response.status !== 200);
    assert.equal(winners.length, 1, JSON.stringify(contenderBodies));
    assert.equal(losers.length, 1, JSON.stringify(contenderBodies));
    assert.equal(winners[0].body.success, true);
    assert.equal(winners[0].body.alreadyInitialized, false);
    assert.equal(winners[0].body.rank, 8);
    assert.equal(losers[0].response.status, 409);
    assert.equal(losers[0].body.error, 'NO_FREE_SLOTS_IN_LEAGUE');

    replacementUid = winners[0].contender.uid;
    replacementPlayerRef = contenderPlayerRefs[contenders.findIndex(({ uid }) => uid === replacementUid)];
    replacementActivityRef = contenderActivityRefs[contenders.findIndex(({ uid }) => uid === replacementUid)];
    replacementAuditQuery = contenderAuditQueries[contenders.findIndex(({ uid }) => uid === replacementUid)];
    for (const contender of contenders) {
      if (contender.uid !== replacementUid) await auth.deleteUser(contender.uid);
    }
    const losingUid = losers[0].contender.uid;
    assert.equal((await db.collection('players_v14').doc(losingUid).get()).exists, false);
    // The authenticated losing contender may record session activity, but it
    // must not receive a club, standings row, or registration audit event.
    assert.equal((await db.collection('user_activity_v1').doc(losingUid).get()).exists, true);
    assert.equal((await db.collection('security_audit_v1').where('actorUid', '==', losingUid).get()).size, 0);
    assert.equal((await db.collection('players_v14').doc(replacementUid).get()).exists, true);
    assert.equal((await db.collection('security_audit_v1').where('actorUid', '==', replacementUid).get()).size, 1);
    assert.equal((await statsRef.get()).get('totalPlayers'), 1002);

    const reclaimedSlot = (await db.collection('league_slots_v1').doc(targetSlotId).get()).data();
    assert.equal(reclaimedSlot.status, 'OCCUPIED');
    assert.equal(reclaimedSlot.occupantId, replacementUid);
    assert.equal(reclaimedSlot.occupancyGeneration, 10);
    assert.equal((await playerRef.get()).exists, false);
    const replacementPlayer = await db.collection('players_v14').doc(replacementUid).get();
    assert.equal(replacementPlayer.exists, true);
    assert.equal(replacementPlayer.get('clubName'), 'Replacement Club');
    assert.equal((await replacementBotRef.get()).exists, false);

    const finalTable = (await tableRef.get()).data();
    assert.equal(finalTable.stats[replacementUid].rank, 8);
    assert.equal(finalTable.stats[replacementUid].isBot, false);
    assert.equal(finalTable.stats[replacementUid].matchesPlayed, 4);
    assert.equal(finalTable.stats[replacementUid].wins, 3);
    assert.equal(finalTable.stats[replacementUid].losses, 1);
    assert.equal(finalTable.stats[replacementUid].points, 9);
    assert.equal(finalTable.stats[replacementUid].diff, 5);
    assert.equal(finalTable.stats[uid], undefined);
    assert.equal(finalTable.stats[replacementBotId], undefined);

    const completedMatchAfter = (await completedMatchRef.get()).data();
    assert.deepEqual(completedMatchAfter, completedMatchBefore);
    const futureFixture = (await db.collection('matches_v2')
      .doc(`${runId}-match-8-2`).get()).data();
    assert.equal(futureFixture.homeId, replacementUid);
    assert.equal(futureFixture.homeLogo, null);

    const archivedAfterReclaim = (await archiveRef.get()).data();
    assert.deepEqual(archivedAfterReclaim, archivedBeforeReclaim);
    assert.equal((await retirementHistoryRef.get()).get('previousOccupantId'), uid);
    assert.equal((await retirementHistoryRef.get()).get('newOccupantId'), replacementBotId);
    assert.equal((await db.collection('league_slot_history_v1')
      .doc(`${targetSlotId}_G10`).get()).get('newOccupantId'), replacementUid);

    // Exercise repeated ownership generations on the same slot:
    // USER -> BOT -> USER -> BOT -> USER. Each retirement and registration
    // must advance generation exactly once and preserve the same standings.
    let currentOwnerUid = replacementUid;
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      const currentActivityRef = db.collection('user_activity_v1').doc(currentOwnerUid);
      const currentArchiveRef = db.collection('inactive_clubs_v1').doc(currentOwnerUid);
      const currentPlayerRef = db.collection('players_v14').doc(currentOwnerUid);
      const currentInactiveSince = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      await currentActivityRef.set({ uid: currentOwnerUid, lastActiveAt: currentInactiveSince });
      const currentAuthRecord = await auth.getUser(currentOwnerUid);
      const cycleRetirementAuth = {
        getUser: async (targetUid) => {
          const record = await auth.getUser(targetUid);
          return {
            ...record,
            metadata: { ...record.metadata, lastSignInTime: currentInactiveSince },
          };
        },
        updateUser: (...args) => auth.updateUser(...args),
        revokeRefreshTokens: (...args) => auth.revokeRefreshTokens(...args),
      };
      const beforeGeneration = 10 + (cycle - 1) * 2;
      const cycleRetirement = await retireInactiveClub({
        db,
        auth: cycleRetirementAuth,
        userRecord: {
          ...currentAuthRecord,
          metadata: { ...currentAuthRecord.metadata, lastSignInTime: currentInactiveSince },
        },
        now: new Date(),
      });
      assert.equal(cycleRetirement.action, 'RETIRED_AND_REPLACED');
      assert.equal((await auth.getUser(currentOwnerUid)).disabled, true);
      assert.equal((await currentPlayerRef.get()).exists, false);
      const freed = (await db.collection('league_slots_v1').doc(targetSlotId).get()).data();
      assert.equal(freed.status, 'FREE');
      assert.equal(freed.occupantId, null);
      assert.equal(freed.occupancyGeneration, beforeGeneration + 1);
      const retirementEvent = await db.collection('league_slot_history_v1')
        .doc(`${targetSlotId}_G${beforeGeneration + 1}`).get();
      assert.equal(retirementEvent.get('reason'), 'INACTIVITY_RETIREMENT');
      assert.equal(retirementEvent.get('previousOccupantId'), currentOwnerUid);
      assert.equal(retirementEvent.get('newOccupantId'), replacementBotId);
      const immutableArchive = (await currentArchiveRef.get()).data();
      assert.equal(immutableArchive.uid, currentOwnerUid);
      historyRefs.push(retirementEvent.ref);

      const nextEmail = `cycle-${cycle}-${runId}@example.test`;
      const nextPassword = `Cycle-${randomUUID()}-Cc3!`;
      const nextUser = await auth.createUser({
        email: nextEmail,
        password: nextPassword,
        emailVerified: true,
      });
      contenderUidsForCleanup.push(nextUser.uid);
      const nextLogin = await fetch(
        `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: nextEmail, password: nextPassword, returnSecureToken: true }),
        },
      );
      assert.equal(nextLogin.status, 200);
      const nextTokens = await nextLogin.json();
      const nextResponse = await POST(new Request('http://localhost/api/registration/initialize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${nextTokens.idToken}`,
        },
        body: JSON.stringify({ clubName: `Cycle ${cycle} Club` }),
      }));
      const nextBody = await nextResponse.json();
      assert.equal(nextResponse.status, 200, JSON.stringify(nextBody));
      assert.equal(nextBody.alreadyInitialized, false);
      assert.equal(nextBody.rank, 8);
      currentOwnerUid = nextUser.uid;
      const occupied = (await db.collection('league_slots_v1').doc(targetSlotId).get()).data();
      assert.equal(occupied.status, 'OCCUPIED');
      assert.equal(occupied.occupantId, currentOwnerUid);
      assert.equal(occupied.occupancyGeneration, beforeGeneration + 2);
      const registrationEvent = await db.collection('league_slot_history_v1')
        .doc(`${targetSlotId}_G${beforeGeneration + 2}`).get();
      assert.equal(registrationEvent.get('reason'), 'NEW_REGISTRATION');
      assert.equal(registrationEvent.get('previousOccupantId'), replacementBotId);
      assert.equal(registrationEvent.get('newOccupantId'), currentOwnerUid);
      historyRefs.push(registrationEvent.ref);
      const currentStanding = (await tableRef.get()).get(`stats.${currentOwnerUid}`);
      assert.equal(currentStanding.matchesPlayed, 4);
      assert.equal(currentStanding.wins, 3);
      assert.equal(currentStanding.losses, 1);
      assert.equal(currentStanding.points, 9);
      assert.equal(currentStanding.diff, 5);
      assert.equal((await db.collection('players_v14').doc(replacementBotId).get()).exists, false);
      assert.equal((await statsRef.get()).get('totalPlayers'), 1002 + cycle);
    }
    assert.equal((await db.collection('league_slots_v1').doc(targetSlotId).get()).get('occupancyGeneration'), 14);
    assert.equal((await db.collection('league_slots_v1').doc(targetSlotId).get()).get('occupantId'), currentOwnerUid);
    assert.equal((await completedMatchRef.get()).data().homeId, botId);
  });
});
