import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, getApps } from 'firebase-admin/app';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.GCLOUD_PROJECT = 'demo-forge-rivals-cup-test';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test('prepared Season 2 receives its complete Pyramid Cup before publication in an isolated Firestore Emulator project', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);

  const [{ getAdminDb }, { getTableId, MAX_LEVELS, TEAMS_PER_GROUP }, { MATCH_COLLECTIONS }, { preparePyramidCupForSeason }] = await Promise.all([
    import('../src/lib/firebase-admin.ts'),
    import('../src/app/lib/leagues-data.ts'),
    import('../src/app/lib/match-storage.ts'),
    import('../src/app/actions/cup-engine.ts'),
  ]);
  const db = getAdminDb();
  const runId = randomUUID();
  const season = 2;
  const seasonStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const configRef = db.collection('system_v1').doc('season_config');
  const cupRef = db.collection('cup_pyramid_v1').doc(`cup_s${season}_lALPHA`);
  const tableRefs = [];
  const fixtureRefs = [];

  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const tableRef = db.collection('league_tables_v2').doc(getTableId(season, 'ALPHA', level, group));
      tableRefs.push(tableRef);
    }
  }

  t.after(async () => {
    const batch = db.batch();
    [configRef, cupRef, ...tableRefs, ...fixtureRefs].forEach(ref => batch.delete(ref));
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
  let teamCount = 0;
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const stats = {};
      for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
        const id = `BOT_CUP_TEST_S${season}_D${level}_G${group}_R${rank}`;
        stats[id] = { id, name: `Test D${level} G${group} R${rank}`, rank, isBot: true };
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
  await tableBatch.commit();
  assert.equal(teamCount, 120);

  const result = await preparePyramidCupForSeason(season);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.generated, true);
  assert.equal(result.participants, 120);
  assert.equal(result.preliminaryMatches, 56);
  assert.equal(result.byes, 8);
  assert.equal(result.scheduledAt, seasonStart.toISOString());

  const cupSnap = await cupRef.get();
  assert.equal(cupSnap.exists, true);
  const cup = cupSnap.data();
  assert.equal(cup.status, 'active');
  assert.equal(cup.currentRound, 1);
  assert.equal(cup.participants.length, 120);
  assert.equal(cup.rounds.r1.length, 64);
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
    assert.equal(fixture.scheduledAt.toMillis(), seasonStart.getTime());
  }

  const retry = await preparePyramidCupForSeason(season);
  assert.equal(retry.success, true, JSON.stringify(retry));
  assert.equal(retry.alreadyExists, true);
  assert.equal((await cupRef.get()).data().rounds.r1.length, 64);
});
