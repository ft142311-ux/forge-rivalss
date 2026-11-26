export type RecoveryHistoryEntry<TRef> = {
  seasonNumber: number;
  reason: string;
  ref: TRef;
};

export type RecoveryPublicationWrite<TRef> = {
  ref: TRef;
  data: any;
};

type MarkerDecision = {
  ready: boolean;
  shouldWrite: boolean;
  reason: string | null;
};

export type PublishRecoveryRolloverDecisionArgs<TRef, TPlan> = {
  planRef: TRef;
  plan: TPlan;
  historyEntries: RecoveryHistoryEntry<TRef>[];
  targetSeason: number;
  batchLimit: number;
  read: (ref: TRef) => Promise<any | null>;
  commitPlan: (ref: TRef, plan: TPlan) => Promise<void>;
  commitHistory: (writes: RecoveryPublicationWrite<TRef>[]) => Promise<void>;
  comparePlans: (existing: any, candidate: TPlan) => { same: boolean; reason: string | null; field?: string | null };
  resolvePendingMarker: (existing: any, expected: {
    seasonNumber: number;
    reason: string;
    targetSeason: number;
  }) => MarkerDecision;
  buildPendingMarker: (entry: RecoveryHistoryEntry<TRef>, targetSeason: number) => any;
};

/**
 * Publish the immutable rollover decision before its repairable history markers.
 * Every read is completed before the first write. If the process stops after
 * plan publication or between marker chunks, a retry reuses the same plan and
 * writes only markers that are still missing.
 */
export async function publishRecoveryRolloverDecision<TRef, TPlan>(
  args: PublishRecoveryRolloverDecisionArgs<TRef, TPlan>,
): Promise<{ ready: true; plan: TPlan | any } | {
  ready: false;
  reason: string;
  details?: { field?: string | null; seasonNumber?: number; targetSeason: number };
}> {
  if (!Number.isSafeInteger(args.targetSeason) || args.targetSeason < 2 ||
      !Number.isSafeInteger(args.batchLimit) || args.batchLimit < 1) {
    return { ready: false, reason: 'RECOVERY_PUBLICATION_ARGUMENTS_INVALID', details: { targetSeason: args.targetSeason } };
  }

  const existingMarkers = await Promise.all(args.historyEntries.map(entry => args.read(entry.ref)));
  const historyWrites: RecoveryPublicationWrite<TRef>[] = [];
  for (let index = 0; index < args.historyEntries.length; index++) {
    const entry = args.historyEntries[index];
    const decision = args.resolvePendingMarker(existingMarkers[index], {
      seasonNumber: entry.seasonNumber,
      reason: entry.reason,
      targetSeason: args.targetSeason,
    });
    if (!decision.ready) {
      return {
        ready: false,
        reason: decision.reason || 'SKIPPED_SEASON_HISTORY_CONFLICT',
        details: { seasonNumber: entry.seasonNumber, targetSeason: args.targetSeason },
      };
    }
    if (decision.shouldWrite) {
      historyWrites.push({
        ref: entry.ref,
        data: args.buildPendingMarker(entry, args.targetSeason),
      });
    }
  }

  const existingPlan = await args.read(args.planRef);
  let persistedPlan: TPlan | any = args.plan;
  if (existingPlan !== null && existingPlan !== undefined) {
    const comparison = args.comparePlans(existingPlan, args.plan);
    if (!comparison.same) {
      return {
        ready: false,
        reason: comparison.reason || 'RECOVERY_ROLLOVER_PLAN_CONFLICT',
        details: { field: comparison.field || null, targetSeason: args.targetSeason },
      };
    }
    persistedPlan = existingPlan;
  } else {
    await args.commitPlan(args.planRef, args.plan);
  }

  for (let offset = 0; offset < historyWrites.length; offset += args.batchLimit) {
    await args.commitHistory(historyWrites.slice(offset, offset + args.batchLimit));
  }
  return { ready: true, plan: persistedPlan };
}
