import { FieldValue } from 'firebase-admin/firestore';
import { acquireSeasonCalendarBuildLock, commitSeasonHistoryCleanupWrites, releaseSeasonCalendarBuildLock } from './season-rollover-lock';
import { resolveRolloverPlanPruneIds, validateRolloverPlan } from './season-rollover-plan';
import { resolveActivatedSkippedHistoryMarker, resolveActivatedSkippedSeasons, resolveHistoryCleanupPostflight } from './season-history-policy';
import { isRolloverPlanPublicationReady } from './season-awards-policy';
import { resolveArchivePrunePlan } from './season-archive';

/**
 * Enforce the rolling one-archive policy only after a season has activated.
 * Verify the retained archive before deleting anything; delete nested match
 * documents explicitly because Firestore does not cascade subcollections.
 */
export async function pruneSeasonHistoryAfterActivation(
  db: any,
  targetSeason: number,
  retainedArchiveSeason: number | null,
) {
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  const activeConfig = configSnap.exists ? configSnap.data() || {} : null;
  if (!activeConfig || Number(activeConfig.activeSeasonNumber) !== targetSeason || activeConfig.worldReady !== true) {
    throw new Error('SEASON_HISTORY_CLEANUP_TARGET_NOT_ACTIVE');
  }

  const activePlanRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const activePlanSnap = await activePlanRef.get();
  const activePlan = activePlanSnap.exists ? activePlanSnap.data() || {} : null;
  if (!validateRolloverPlan(activePlan, targetSeason - 1, targetSeason).valid || !isRolloverPlanPublicationReady(activePlan)) {
    throw new Error('ACTIVATED_SEASON_ROLLOVER_PLAN_MISSING_OR_INVALID');
  }

  // The activation transaction durably records skipped seasons in both the
  // active rollover plan and season_config. Reapply their final history status
  // here so every cleanup entry point can recover after any post-activation
  // interruption, including a crash before the original status-write batches.
  const configSkipped = resolveActivatedSkippedSeasons(activeConfig.lastRecoverySkippedSeasons, targetSeason);
  const planSkipped = resolveActivatedSkippedSeasons(activePlan.skippedSeasons, targetSeason);
  if (!configSkipped.ready || !planSkipped.ready ||
      JSON.stringify(configSkipped.seasons) !== JSON.stringify(planSkipped.seasons)) {
    throw new Error('ACTIVATED_SKIPPED_SEASON_MARKERS_INVALID');
  }
  const cleanupLock = await acquireSeasonCalendarBuildLock(db, targetSeason - 1, targetSeason);
  if (!cleanupLock.acquired) throw new Error('SEASON_HISTORY_CLEANUP_LOCKED');
  try {
    const skippedHistoryRefs = configSkipped.seasons.map(item => ({
      item,
      ref: db.collection('league_season_history_v1').doc(`S${item.seasonNumber}`),
    }));
    const skippedHistorySnapshots = await Promise.all(skippedHistoryRefs.map(entry => entry.ref.get()));
    const skippedHistoryWrites: Array<{ ref: any; data: any; options?: any }> = [];
    for (let index = 0; index < skippedHistoryRefs.length; index++) {
      const { item, ref } = skippedHistoryRefs[index];
      const snapshot = skippedHistorySnapshots[index];
      const marker = resolveActivatedSkippedHistoryMarker(
        snapshot.exists ? snapshot.data() || {} : null,
        { seasonNumber: item.seasonNumber, reason: item.reason, targetSeason },
      );
      if (!marker.ready) {
        throw new Error(`SKIPPED_SEASON_HISTORY_CONFLICT:S${item.seasonNumber}`);
      }
      if (marker.shouldWrite) {
        skippedHistoryWrites.push({
          ref,
          data: {
            seasonNumber: item.seasonNumber,
            status: 'SKIPPED',
            reason: item.reason,
            activatedTargetSeason: targetSeason,
            activatedAt: FieldValue.serverTimestamp(),
            noResultsFabricated: true,
            awardsApplied: false,
            promotionRelegationApplied: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          options: { merge: true },
        });
      }
    }
    for (let offset = 0; offset < skippedHistoryWrites.length; offset += 400) {
      await commitSeasonHistoryCleanupWrites(
        db, cleanupLock.ownerId, cleanupLock.token, targetSeason,
        skippedHistoryWrites.slice(offset, offset + 400),
      );
    }

  const [archivesSnap, historySnap, plansSnap] = await Promise.all([
    db.collection('league_season_archives_v1').get(),
    db.collection('league_season_history_v1').get(),
    db.collection('league_season_rollovers_v1').get(),
  ]);
  const historyById = new Map<string, any>(historySnap.docs.map((doc: any): [string, any] => [doc.id, doc.data() || {}]));
  const archiveItems = [];
  for (const archiveDoc of archivesSnap.docs) {
    const archive = archiveDoc.data() || {};
    const pruningForThisTarget = archive.pruneStatus === 'PRUNING' &&
      Number(archive.pruneTargetSeason) === targetSeason &&
      Number(archive.pruneRetainedArchiveSeason || 0) === Number(retainedArchiveSeason || 0) &&
      Number(archive.prunePolicyVersion) === 1;
    const matchesSnap = pruningForThisTarget
      ? null
      : await archiveDoc.ref.collection('matches').get();
    archiveItems.push({
      id: archiveDoc.id,
      ref: archiveDoc.ref,
      archive,
      matches: matchesSnap ? matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id })) : [],
      historyStatus: String((historyById.get(archiveDoc.id) || {}).status || ''),
    });
  }
  const archivePlan = resolveArchivePrunePlan(
    archiveItems.map(({ id, archive, matches, historyStatus }) => ({ id, archive, matches, historyStatus })),
    targetSeason,
    retainedArchiveSeason,
  );
  if (!archivePlan.ready) throw new Error(archivePlan.reason || 'ARCHIVE_PRUNE_PREFLIGHT_FAILED');

  const rolloverPlan = resolveRolloverPlanPruneIds(
    plansSnap.docs.map((doc: any) => ({ id: doc.id, plan: doc.data() || {} })),
    targetSeason,
  );
  if (!rolloverPlan.ready) throw new Error(rolloverPlan.reason || 'ROLLOVER_PLAN_PRUNE_PREFLIGHT_FAILED');

  // Persist a deletion intent only after every archive and plan passed
  // validation. A retry can resume child-document deletion after interruption.
  for (const archiveId of archivePlan.pruneIds) {
    const item = archiveItems.find(candidate => candidate.id === archiveId)!;
    if (item.archive.pruneStatus !== 'PRUNING') {
      await commitSeasonHistoryCleanupWrites(db, cleanupLock.ownerId, cleanupLock.token, targetSeason, [{
        ref: item.ref,
        data: {
          pruneStatus: 'PRUNING',
          pruneTargetSeason: targetSeason,
          pruneRetainedArchiveSeason: retainedArchiveSeason,
          prunePolicyVersion: 1,
          pruneStartedAt: FieldValue.serverTimestamp(),
        },
        options: { merge: true },
      }]);
    }
  }

  let deletedArchives = 0;
  let deletedArchiveMatches = 0;
  for (const archiveId of archivePlan.pruneIds) {
    const item = archiveItems.find(candidate => candidate.id === archiveId)!;
    const matchesSnap = await item.ref.collection('matches').get();
    for (let offset = 0; offset < matchesSnap.docs.length; offset += 400) {
      const chunk = matchesSnap.docs.slice(offset, offset + 400);
      await commitSeasonHistoryCleanupWrites(db, cleanupLock.ownerId, cleanupLock.token, targetSeason, [], chunk.map((matchDoc: (typeof matchesSnap.docs)[number]) => matchDoc.ref));
      deletedArchiveMatches += chunk.length;
    }
    await commitSeasonHistoryCleanupWrites(db, cleanupLock.ownerId, cleanupLock.token, targetSeason, [], [item.ref]);
    deletedArchives++;
  }

  let deletedRolloverPlans = 0;
  for (let offset = 0; offset < rolloverPlan.pruneIds.length; offset += 400) {
    const chunk = rolloverPlan.pruneIds.slice(offset, offset + 400);
    if (chunk.length) await commitSeasonHistoryCleanupWrites(db, cleanupLock.ownerId, cleanupLock.token, targetSeason, [], chunk.map(planId => db.collection('league_season_rollovers_v1').doc(planId)));
    deletedRolloverPlans += chunk.length;
  }

  // Re-read persisted state after all deletion batches. A successful batch
  // response alone is not enough to clear the durable cleanup marker.
  const [postflightArchivesSnap, postflightHistorySnap, postflightPlansSnap] = await Promise.all([
    db.collection('league_season_archives_v1').get(),
    db.collection('league_season_history_v1').get(),
    db.collection('league_season_rollovers_v1').get(),
  ]);
  const postflightHistoryById = new Map<string, any>(
    postflightHistorySnap.docs.map((doc: any): [string, any] => [doc.id, doc.data() || {}]),
  );
  const postflightArchiveItems = [];
  for (const archiveDoc of postflightArchivesSnap.docs) {
    const matchesSnap = await archiveDoc.ref.collection('matches').get();
    postflightArchiveItems.push({
      id: archiveDoc.id,
      archive: archiveDoc.data() || {},
      matches: matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id })),
      historyStatus: String((postflightHistoryById.get(archiveDoc.id) || {}).status || ''),
    });
  }
  const postflightArchivePlan = resolveArchivePrunePlan(
    postflightArchiveItems, targetSeason, retainedArchiveSeason,
  );
  const postflightRolloverPlan = resolveRolloverPlanPruneIds(
    postflightPlansSnap.docs.map((doc: any) => ({ id: doc.id, plan: doc.data() || {} })),
    targetSeason,
  );
  const postflightSkippedMarkers = configSkipped.seasons.map(item =>
    resolveActivatedSkippedHistoryMarker(
      postflightHistoryById.get(`S${item.seasonNumber}`) || null,
      { seasonNumber: item.seasonNumber, reason: item.reason, targetSeason },
    ),
  );
  const postflight = resolveHistoryCleanupPostflight({
    archivePlan: postflightArchivePlan,
    rolloverPlan: postflightRolloverPlan,
    skippedHistoryMarkers: postflightSkippedMarkers,
  });
  if (!postflight.ready) throw new Error(postflight.reason || 'SEASON_HISTORY_CLEANUP_POSTFLIGHT_FAILED');

  return {
    deletedArchives,
    deletedArchiveMatches,
    deletedRolloverPlans,
    retainedArchiveSeason,
    };
  } finally {
    await releaseSeasonCalendarBuildLock(db, cleanupLock.ownerId, cleanupLock.token);
  }
}
