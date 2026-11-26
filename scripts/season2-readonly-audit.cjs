const admin = require('firebase-admin');

const app = admin.initializeApp({
  projectId: 'demo-forge-rivals',
}, 'season2-readonly-audit');

const db = app.firestore();

async function inspect(collection, ids) {
  for (const id of ids) {
    const snap = await db.collection(collection).doc(id).get();
    console.log(JSON.stringify({
      path: `${collection}/${id}`,
      exists: snap.exists,
      data: snap.exists ? snap.data() : null,
    }, null, 2));
  }
}

(async () => {
  try {
    console.log('=== SEASON CONFIG ===');
    await inspect('system_v1', ['season_config']);

    console.log('=== ARCHIVE AND ROLLOVER PLAN ===');
    await inspect('league_season_archives_v1', ['S1']);
    await inspect('league_season_rollovers_v1', ['S2']);

    console.log('=== ROLLOVER LOCK ===');
    await inspect('system_v1', ['season_rollover_v1']);

    console.log('=== SEASON 2 TABLES ===');
    const tables = await db.collection('league_tables_v2')
      .where('season', '==', 2)
      .get();
    console.log(JSON.stringify({
      count: tables.size,
      ids: tables.docs.map(d => d.id),
    }, null, 2));

    console.log('=== SEASON 2 SLOTS ===');
    const slots = await db.collection('league_slots_v1')
      .where('season', '==', 2)
      .get();
    console.log(JSON.stringify({
      count: slots.size,
      ids: slots.docs.map(d => d.id),
    }, null, 2));

    console.log('=== SEASON 2 CANONICAL MATCHES ===');
    const matches = await db.collection('matches_v2')
      .where('season', '==', 2)
      .where('leagueId', '==', 'ALPHA')
      .where('version', '==', 140)
      .get();
    console.log(JSON.stringify({
      count: matches.size,
      sampleIds: matches.docs.slice(0, 10).map(d => d.id),
    }, null, 2));
  } catch (error) {
    console.error('READ_ONLY_AUDIT_FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    await app.delete();
  }
})();
