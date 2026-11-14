import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

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
    const auditQuery = db.collection('security_audit_v1').where('actorUid', '==', uid);
    const tableRef = db.collection('league_tables_v2')
      .doc(`table_v140_S${season}_LALPHA_V${division}_G${group}`);
    const configRef = db.collection('system_v1').doc('season_config');
    const statsRef = db.collection('system_v1').doc('global_stats');
    const playerRef = db.collection('players_v14').doc(uid);
    const botPlayerRef = db.collection('players_v14').doc(botId);

    t.after(async () => {
      const auditSnapshot = await auditQuery.get();
      const cleanupRefs = [
        ...slotRefs,
        ...matchRefs,
        ...auditSnapshot.docs.map((doc) => doc.ref),
        tableRef,
        configRef,
        statsRef,
        playerRef,
        botPlayerRef,
      ];
      for (let i = 0; i < cleanupRefs.length; i += 400) {
        const batch = db.batch();
        for (const ref of cleanupRefs.slice(i, i + 400)) batch.delete(ref);
        await batch.commit();
      }
      await auth.deleteUser(uid).catch(() => undefined);
      await deleteApp(app);
    });

    await configRef.set({
      activeSeasonNumber: season,
      phase: 'REGULAR_SEASON',
      worldReady: true,
    });
    await statsRef.set({ totalPlayers: 1000 });

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
    await botPlayerRef.set({ id: botId, clubName: 'Test Bot' });

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
          homeRank,
          awayRank,
          isFinished: homeRank === 8 && awayRank === 1,
          status: homeRank === 8 && awayRank === 1 ? 'finished' : 'scheduled',
          startTime: homeRank === 8 && awayRank === 1
            ? '2026-10-01T12:00:00.000Z'
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
    const { idToken } = await signIn.json();
    assert.equal(typeof idToken, 'string');

    const request = () => POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ clubName: 'Forge Test Club' }),
    }));

    const response = await request();
    const responseBody = await response.json();
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.alreadyInitialized, false);
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
    assert.equal(historicalBotMatch.get('scoreA'), 2);
    assert.equal(historicalBotMatch.get('scoreB'), 1);
    assert.equal(matches.docs.filter((doc) =>
      doc.get('homeId') === botId || doc.get('awayId') === botId
    ).length, 1);
    assert.equal(stats.get('totalPlayers'), 1001);
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].get('event'), 'CLUB_REGISTRATION_COMPLETED');

    const retryResponse = await request();
    const retryBody = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
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
  });
});
