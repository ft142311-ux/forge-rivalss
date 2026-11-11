import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '../src/lib/firebase-admin';
import { isCompletedSeasonArchive, validateSeasonArchiveSnapshot } from '../src/app/actions/season-archive';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan';

async function main() {
  const db = getAdminDb();
  const configRef = db.doc('system_v1/season_config');
  const archiveRef = db.doc('league_season_archives_v1/S1');
  const planRef = db.doc('league_season_rollovers_v1/S2');
  const [configSnap, archiveSnap, archiveMatchesSnap, planSnap, tablesSnap, slotsSnap, matchesSnap, archive2Snap] = await Promise.all([
    configRef.get(), archiveRef.get(), archiveRef.collection('matches').get(), planRef.get(),
    db.collection('league_tables_v2').where('season', '==', 2).get(),
    db.collection('league_slots_v1').where('season', '==', 2).get(),
    db.collection('matches_v2').where('season', '==', 2).get(),
    db.doc('league_season_archives_v1/S2').get(),
  ]);
  const archive = archiveSnap.data() || {};
  const archiveMatches = archiveMatchesSnap.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
  if (!configSnap.exists || Number(configSnap.data()?.activeSeasonNumber) !== 1 ||
      configSnap.data()?.phase !== 'GENERATING_NEXT' || Number(configSnap.data()?.nextSeasonNumber) !== 2 ||
      !isCompletedSeasonArchive(archive) || !validateSeasonArchiveSnapshot(archive, archiveMatches).valid ||
      !validateRolloverPlan(planSnap.data(), 1, 2).valid ||
      tablesSnap.size !== 0 || slotsSnap.size !== 0 || matchesSnap.size !== 0 || archive2Snap.exists) {
    throw new Error('BLOCKED_S1_TRANSITION_RESTORE_GUARD_FAILED');
  }

  await db.runTransaction(async (tx: any) => {
    const current = await tx.get(configRef);
    if (!current.exists || Number(current.data()?.activeSeasonNumber) !== 1 ||
        current.data()?.phase !== 'GENERATING_NEXT' || Number(current.data()?.nextSeasonNumber) !== 2) {
      throw new Error('SEASON_CONFIG_CHANGED_BEFORE_RESTORE');
    }
    tx.update(configRef, {
      phase: 'REGULAR_SEASON',
      nextSeasonNumber: FieldValue.delete(),
      preparationTargetSeason: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const verified = await configRef.get();
  const data = verified.data() || {};
  const success = Number(data.activeSeasonNumber) === 1 && data.phase === 'REGULAR_SEASON' &&
    data.worldReady === true && data.nextSeasonNumber === undefined && data.preparationTargetSeason === undefined;
  console.log(JSON.stringify({
    success,
    restoredFields: ['phase=REGULAR_SEASON', 'nextSeasonNumber cleared', 'preparationTargetSeason cleared'],
    config: {
      activeSeasonNumber: data.activeSeasonNumber,
      phase: data.phase,
      worldReady: data.worldReady,
      seasonStart: data.seasonStart,
      nextSeasonStart: data.nextSeasonStart,
      nextSeasonNumber: data.nextSeasonNumber ?? null,
      preparationTargetSeason: data.preparationTargetSeason ?? null,
    },
    s2DocumentsBeforeRestore: { tables: tablesSnap.size, slots: slotsSnap.size, matches: matchesSnap.size, archive: archive2Snap.exists },
  }, null, 2));
  await db.terminate();
  if (!success) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
