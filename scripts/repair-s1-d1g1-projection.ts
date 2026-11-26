import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../src/lib/firebase-admin';
import { acquireSeasonRolloverLock, releaseSeasonRolloverLock, SEASON_ROLLOVER_LOCK_ID, SEASON_ROLLOVER_LOCK_TTL_MS } from '../src/app/actions/season-rollover-lock';
import { validateSeasonArchiveSnapshot, isCompletedSeasonArchive } from '../src/app/actions/season-archive';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan';
import { diagnoseSeasonRolloverPreflight } from '../src/app/actions/season-rollover';
import { getTableId } from '../src/app/lib/leagues-data';

async function main() {
  const db = getAdminDb();
  const configRef = db.doc('system_v1/season_config');
  const archiveRef = db.doc('league_season_archives_v1/S1');
  const tableRef = db.collection('league_tables_v2').doc(getTableId(1, 'ALPHA', 1, 1));
  const [configSnap, archiveSnap, archiveMatchesSnap, planSnap, tableSnap] = await Promise.all([
    configRef.get(), archiveRef.get(), archiveRef.collection('matches').get(),
    db.doc('league_season_rollovers_v1/S2').get(), tableRef.get(),
  ]);
  const config = configSnap.data() || {};
  const archive = archiveSnap.data() || {};
  const archiveMatches = archiveMatchesSnap.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
  const archiveStandings = archive.standings?.['D1-G1'];
  const stats = Array.isArray(archiveStandings)
    ? Object.fromEntries(archiveStandings.map((row: any) => [String(row.id), { ...row, id: String(row.id), rank: Number(row.rank) }]))
    : null;

  if (Number(config.activeSeasonNumber) !== 1 || config.seasonStart !== '2026-09-21T15:00:00.000Z' ||
      config.nextSeasonStart !== '2026-10-08T15:00:00.000Z' || !isCompletedSeasonArchive(archive) ||
      !validateSeasonArchiveSnapshot(archive, archiveMatches).valid || !validateRolloverPlan(planSnap.data(), 1, 2).valid ||
      !tableSnap.exists || !stats || Object.keys(stats).length !== 8 ||
      !Object.values(stats).some((row: any) => row.id === 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba' && row.rank === 5) ||
      Object.values(stats).some((row: any) => row.id === 'BOT_ALPHA_L1_G1_R5')) {
    throw new Error('D1_G1_ARCHIVE_BACKED_REPAIR_GUARD_FAILED');
  }

  const existingStats = tableSnap.data()?.stats || {};
  if (!Object.values(existingStats).some((row: any) => row.id === 'BOT_ALPHA_L1_G1_R5')) {
    const strict = await diagnoseSeasonRolloverPreflight(db, 1, false);
    console.log(JSON.stringify({ success: strict.ready === true, alreadyRepaired: true, strictPreflight: strict }, null, 2));
    await db.terminate();
    return;
  }

  const lock = await acquireSeasonRolloverLock(db, 1, 2);
  if (!lock.acquired) throw new Error('D1_G1_REPAIR_LOCKED');
  try {
    const [freshConfig, freshArchive, freshArchiveMatches, freshTable, freshPlan] = await Promise.all([
      configRef.get(), archiveRef.get(), archiveRef.collection('matches').get(), tableRef.get(), db.doc('league_season_rollovers_v1/S2').get(),
    ]);
    const latestArchive = freshArchive.data() || {};
    const latestArchiveMatches = freshArchiveMatches.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
    const latestStats = latestArchive.standings?.['D1-G1'];
    const latestProjection = Array.isArray(latestStats)
      ? Object.fromEntries(latestStats.map((row: any) => [String(row.id), { ...row, id: String(row.id), rank: Number(row.rank) }]))
      : null;
    if (Number(freshConfig.data()?.activeSeasonNumber) !== 1 ||
        !isCompletedSeasonArchive(latestArchive) || !validateSeasonArchiveSnapshot(latestArchive, latestArchiveMatches).valid ||
        !validateRolloverPlan(freshPlan.data(), 1, 2).valid || !freshTable.exists || !latestProjection ||
        Object.keys(latestProjection).length !== 8 ||
        !Object.values(latestProjection).some((row: any) => row.id === 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba' && row.rank === 5)) {
      throw new Error('D1_G1_REPAIR_STATE_CHANGED');
    }
    await db.runTransaction(async (tx: any) => {
      const [lockSnap, currentConfig, currentTable] = await Promise.all([
        tx.get(db.collection('system_v1').doc(SEASON_ROLLOVER_LOCK_ID)),
        tx.get(configRef),
        tx.get(tableRef),
      ]);
      const currentLock = lockSnap.exists ? lockSnap.data() || {} : {};
      const currentConfigData = currentConfig.exists ? currentConfig.data() || {} : {};
      const currentStats = currentTable.exists ? currentTable.data()?.stats || {} : {};
      if (currentLock.ownerId !== lock.ownerId || currentLock.token !== lock.token ||
          Number(currentLock.expiresAtMs || 0) <= Date.now() ||
          Number(currentConfigData.activeSeasonNumber) !== 1 ||
          !Object.values(currentStats).some((row: any) => row.id === 'BOT_ALPHA_L1_G1_R5')) {
        throw new Error('D1_G1_REPAIR_FENCE_OR_STATE_CHANGED');
      }
      const nowMs = Date.now();
      tx.set(db.collection('system_v1').doc(SEASON_ROLLOVER_LOCK_ID), {
        expiresAtMs: nowMs + SEASON_ROLLOVER_LOCK_TTL_MS,
        renewedAtMs: nowMs,
      }, { merge: true });
      tx.update(tableRef, { stats: latestProjection, updatedAt: FieldValue.serverTimestamp() });
    });
  } finally {
    await releaseSeasonRolloverLock(db, lock.ownerId, lock.token);
  }

  const [updatedTable, strictPreflight] = await Promise.all([
    tableRef.get(), diagnoseSeasonRolloverPreflight(db, 1, false),
  ]);
  const updatedStats = updatedTable.data()?.stats || {};
  const repaired = Object.keys(updatedStats).length === 8 &&
    !Object.values(updatedStats).some((row: any) => row.id === 'BOT_ALPHA_L1_G1_R5') &&
    Object.values(updatedStats).some((row: any) => row.id === 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba' && Number(row.rank) === 5);
  console.log(JSON.stringify({ success: repaired && strictPreflight.ready === true, repaired, strictPreflight }, null, 2));
  await db.terminate();
  if (!repaired || strictPreflight.ready !== true) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
