import { getAdminDb } from '../src/lib/firebase-admin';
import { finishTestSeason1AndPrepareSeason2 } from '../src/app/actions/season-cycle';
import { isCompletedSeasonArchive, validateSeasonArchiveSnapshot } from '../src/app/actions/season-archive';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan';

async function main() {
  const db = getAdminDb();
  const configBefore = await db.doc('system_v1/season_config').get();
  const config = configBefore.data() || {};
  if (!configBefore.exists || Number(config.activeSeasonNumber) !== 1 || config.worldReady !== true ||
      config.seasonStart !== '2026-09-21T15:00:00.000Z' || config.nextSeasonStart !== '2026-10-08T15:00:00.000Z') {
    throw new Error('S1_TO_S2_CONFIG_GUARD_FAILED');
  }
  const archive = await db.doc('league_season_archives_v1/S1').get();
  const archiveMatches = await db.collection('league_season_archives_v1/S1/matches').get();
  const plan = await db.doc('league_season_rollovers_v1/S2').get();
  if (!isCompletedSeasonArchive(archive.data()) ||
      !validateSeasonArchiveSnapshot(archive.data(), archiveMatches.docs.map(doc => ({ ...doc.data(), matchId: doc.id }))).valid ||
      !validateRolloverPlan(plan.data(), 1, 2).valid) throw new Error('S1_ARCHIVE_OR_S2_PLAN_INVALID');

  const transition = await finishTestSeason1AndPrepareSeason2();
  const finalConfigSnap = await db.doc('system_v1/season_config').get();
  const finalConfig = finalConfigSnap.data() || {};
  const [tables, slots, matches] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', 2).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', 2).where('leagueId', '==', 'ALPHA').get(),
    db.collection('matches_v2').where('season', '==', 2).where('version', '==', 140).get(),
  ]);
  const report = {
    success: transition.success === true && Number(finalConfig.activeSeasonNumber) === 2 && finalConfig.worldReady === true &&
      tables.size === 15 && slots.size === 120 && matches.size === 840,
    transition,
    config: {
      activeSeasonNumber: finalConfig.activeSeasonNumber ?? null,
      phase: finalConfig.phase ?? null,
      worldReady: finalConfig.worldReady ?? null,
      seasonStart: finalConfig.seasonStart ?? null,
      nextSeasonStart: finalConfig.nextSeasonStart ?? null,
    },
    season2: { tables: tables.size, slots: slots.size, matchDocuments: matches.size },
  };
  console.log(JSON.stringify(report, null, 2));
  await db.terminate();
  if (!report.success) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
