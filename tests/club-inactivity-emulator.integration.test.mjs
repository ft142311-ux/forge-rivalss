import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { retireInactiveClub } = require('../functions/club-inactivity-sweep.js');
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

test('inactive club replacement is atomic and preserves completed match results', {
  skip: !emulatorHost,
}, async (t) => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');

  const app = initializeApp({ projectId }, `inactive-club-test-${randomUUID()}`);
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
  const tableRef = db.collection('league_tables_v2').doc(`table_v140_S${season}_LALPHA_V${division}_G${group}`);
  const archiveRef = db.collection('inactive_clubs_v1').doc(uid);
  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const matchRefs = [];
  const botRef = db.collection('players_v14').doc(botId);

  t.after(async () => {
    await playerRef.delete().catch(() => undefined);
    await slotRef.delete().catch(() => undefined);
    await tableRef.delete().catch(() => undefined);
    await archiveRef.delete().catch(() => undefined);
    await pendingRef.delete().catch(() => undefined);
    await botRef.delete().catch(() => undefined);
    for (const ref of matchRefs) await ref.delete().catch(() => undefined);
    await deleteApp(app);
  });

  const player = {
    id: uid, clubName: 'Inactive Test Club', selectedLeagueId: 'ALPHA',
    lastProcessedSeason: season, leagueLevel: division, groupId: group, rank,
    ownedPlayers: [{ id: 'test-player' }],
  };
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
      homeRank: i === 0 ? rank : 1,
      awayRank: i === 1 ? rank : 2,
      startTime: new Date(now.getTime() + (i + 1) * 60 * 60 * 1000).toISOString(),
      isFinished: i === 0,
      status: i === 0 ? 'finished' : 'scheduled',
      isProcessing: false,
      scoreA: i === 0 ? 2 : 0,
      scoreB: i === 0 ? 1 : 0,
    });
  }

  let disabled = false;
  const auth = {
    getUser: async () => ({ uid, disabled, metadata: { lastSignInTime } }),
    updateUser: async (_uid, patch) => { disabled = patch.disabled; return { uid, disabled }; },
    revokeRefreshTokens: async () => undefined,
  };
  const userRecord = { uid, disabled: false, metadata: { lastSignInTime } };

  const result = await retireInactiveClub({ db, auth, userRecord, now });
  assert.equal(result.action, 'RETIRED_AND_REPLACED');
  assert.equal(disabled, true);
  assert.equal((await playerRef.get()).exists, false);
  assert.equal((await pendingRef.get()).exists, false);
  assert.equal((await archiveRef.get()).get('replacedByBotId'), botId);
  const releasedSlot = await slotRef.get();
  assert.equal(releasedSlot.get('status'), 'FREE');
  assert.equal(releasedSlot.get('occupantId'), null);
  assert.equal(releasedSlot.get('occupancyGeneration'), 1);
  assert.equal(releasedSlot.get('lastOccupantId'), uid);

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
