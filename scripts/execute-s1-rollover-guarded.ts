import { getAdminDb } from '../src/lib/firebase-admin';
import { diagnoseSeasonRolloverPreflight, prepareSeasonRollover } from '../src/app/actions/season-rollover';
import { isCompletedSeasonArchive, validateSeasonArchiveSnapshot } from '../src/app/actions/season-archive';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan';

async function main() {
  const db = getAdminDb();
  const configSnap = await db.doc('system_v1/season_config').get();
  const config = configSnap.exists ? configSnap.data() || {} : {};
  if (Number(config.activeSeasonNumber) !== 1 || config.worldReady !== true ||
      config.seasonStart !== '2026-09-21T15:00:00.000Z' || config.nextSeasonStart !== '2026-10-08T15:00:00.000Z') {
    throw new Error('S1_ROLLOVER_CONFIG_GUARD_FAILED');
  }
  const [archiveBefore, planBefore] = await Promise.all([
    db.doc('league_season_archives_v1/S1').get(),
    db.doc('league_season_rollovers_v1/S2').get(),
  ]);
  if (archiveBefore.exists || planBefore.exists) throw new Error('S1_ROLLOVER_EXISTING_ARCHIVE_OR_PLAN_REQUIRES_REVIEW');

  const preflight = await diagnoseSeasonRolloverPreflight(db, 1, true);
  if (preflight.ready !== true || Number(preflight.observedMatches) !== 840 || Number(preflight.observedTables) !== 15) {
    console.log(JSON.stringify({ success: false, writesStarted: false, preflight }, null, 2));
    process.exitCode = 2;
    await db.terminate();
    return;
  }

  const result = await prepareSeasonRollover(db, 1, 2, true);
  const [archiveAfter, planAfter] = await Promise.all([
    db.doc('league_season_archives_v1/S1').get(),
    db.doc('league_season_rollovers_v1/S2').get(),
  ]);
  const archive = archiveAfter.exists ? archiveAfter.data() || {} : {};
  const archivedMatchesSnap = archiveAfter.exists ? await db.collection('league_season_archives_v1/S1/matches').get() : null;
  const archivedMatches = archivedMatchesSnap?.docs.map(doc => ({ ...doc.data(), matchId: doc.id })) || [];
  const snapshot = archiveAfter.exists ? validateSeasonArchiveSnapshot(archive, archivedMatches) : { valid: false, reasons: ['ARCHIVE_MISSING'] };
  const plan = planAfter.exists ? planAfter.data() || {} : {};
  const verified = result.ready === true && isCompletedSeasonArchive(archive) && snapshot.valid && validateRolloverPlan(plan, 1, 2).valid;

  console.log(JSON.stringify({
    success: verified,
    readOnly: false,
    sourceSeason: 1,
    targetSeason: 2,
    rolloverResult: result,
    archive: { exists: archiveAfter.exists, status: archive.status || null, matchCount: archivedMatches.length, valid: snapshot.valid, reasons: snapshot.reasons },
    plan: { exists: planAfter.exists, ready: plan.ready === true, valid: validateRolloverPlan(plan, 1, 2).valid, promotionRule: plan.promotionRule || null },
    configAfter: { activeSeasonNumber: config.activeSeasonNumber, phase: config.phase, worldReady: config.worldReady },
  }, null, 2));
  await db.terminate();
  if (!verified) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
