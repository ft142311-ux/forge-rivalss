type ActivationDb = {
  runTransaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
};

type ActivationExpectation = {
  sourceSeason: number;
  targetSeason: number;
  calendarRevision: number;
  activationAtMs: number;
  nextSeasonStartMs: number;
  multiSeasonRecovery: boolean;
  recoveryMode: boolean;
  nowMs?: number;
  isPlanReady: (plan: any) => boolean;
  buildUpdate: (current: any, plan: any) => Record<string, any>;
};

/**
 * Atomically switch the active season only after re-reading the prepared config
 * and immutable rollover plan inside the same transaction. The config update
 * includes the durable cleanup marker, so a process crash after commit can
 * always resume post-activation cleanup.
 */
export async function commitSeasonActivation(
  db: ActivationDb,
  configRef: any,
  planRef: any,
  expected: ActivationExpectation,
) {
  return db.runTransaction(async (tx: any) => {
    const [configSnap, planSnap] = await Promise.all([
      tx.get(configRef),
      tx.get(planRef),
    ]);
    if (!configSnap.exists) return { success: false, reason: 'SEASON_CONFIG_MISSING' };

    const current = configSnap.data() || {};
    const plan = planSnap.exists ? planSnap.data() || {} : null;
    const stateMatches =
      Number(current.activeSeasonNumber || 1) === expected.sourceSeason &&
      Number(current.preparedSeasonNumber || 0) === expected.targetSeason &&
      Number(current.nextSeasonNumber || 0) === expected.targetSeason &&
      Number(current.preparationTargetSeason || 0) === expected.targetSeason &&
      current.worldReady === true &&
      current.preparedWorldReady === true &&
      current.preparedPublished === true &&
      String(current.phase || '') === 'PUBLISHED' &&
      Number(current.preparedCalendarRevision || 0) === expected.calendarRevision &&
      new Date(current.preparedSeasonStart || '').getTime() === expected.activationAtMs &&
      new Date(current.preparedNextSeasonStart || '').getTime() === expected.nextSeasonStartMs &&
      (expected.multiSeasonRecovery ||
        new Date(current.nextSeasonStart || '').getTime() === expected.activationAtMs) &&
      (!expected.recoveryMode || current.preparedRecoveryMode === true);

    if (!stateMatches) return { success: false, reason: 'ACTIVATION_STATE_CHANGED' };

    const transactionNowMs = Number(expected.nowMs ?? Date.now());
    if (transactionNowMs < expected.activationAtMs) {
      return { success: false, reason: 'ACTIVATION_NOT_DUE' };
    }
    if (transactionNowMs >= expected.nextSeasonStartMs) {
      return { success: false, reason: 'ACTIVATION_WINDOW_EXPIRED' };
    }
    if (!expected.isPlanReady(plan)) {
      return { success: false, reason: 'ROLLOVER_PLAN_INVALID' };
    }

    tx.update(configRef, expected.buildUpdate(current, plan));
    return { success: true };
  });
}
