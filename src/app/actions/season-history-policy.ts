export type SeasonHistoryState =
  | { status: 'completed'; archiveValid: boolean; archiveReason?: string }
  | { status: 'incomplete'; reason?: string }
  | { status: 'no_canonical_results'; reason?: string }
  | { status: 'integrity_conflict'; reason?: string }
  | { status: 'unknown'; reason?: string };

export type SeasonCatchUpPolicy = {
  ready: boolean;
  reason: string | null;
  skippedSeasons: Array<{ seasonNumber: number; reason: string }>;
  completedSeasons: number[];
  retainedArchiveSeason: number | null;
  archivesToPruneAfterActivation: number[];
};

/**
 * Catch-up history policy:
 * - A season with complete, verified results must be archived; it cannot be
 *   silently skipped just because its archive is missing or corrupt.
 * - A genuinely incomplete season may be recorded as skipped without inventing
 *   scores, standings, awards, or promotion/relegation.
 * - Only the newest verified completed season is retained. Older verified
 *   archives are candidates for deletion only after the target season activates.
 * - Unknown state and integrity conflicts fail closed.
 *
 * This helper is pure. Callers must inspect persisted match data and archive
 * snapshots before supplying states; it never treats an absent archive alone
 * as proof that a season was incomplete.
 */
export function resolveSeasonCatchUpPolicy(
  missedSeasons: number[],
  states: Record<number, SeasonHistoryState>,
): SeasonCatchUpPolicy {
  const ordered = [...new Set(missedSeasons)].sort((a, b) => a - b);
  const skippedSeasons: SeasonCatchUpPolicy['skippedSeasons'] = [];
  const completedSeasons: number[] = [];
  const blocked: number[] = [];

  for (const seasonNumber of ordered) {
    const state = states[seasonNumber];
    if (!state || state.status === 'unknown') {
      blocked.push(seasonNumber);
      continue;
    }
    if (state.status === 'integrity_conflict') {
      blocked.push(seasonNumber);
      continue;
    }
    if (state.status === 'incomplete' || state.status === 'no_canonical_results') {
      skippedSeasons.push({
        seasonNumber,
        reason: state.reason || (state.status === 'incomplete' ? 'SEASON_INCOMPLETE' : 'NO_CANONICAL_RESULTS'),
      });
      continue;
    }
    if (state.status === 'completed') {
      if (!state.archiveValid) {
        blocked.push(seasonNumber);
        continue;
      }
      completedSeasons.push(seasonNumber);
    }
  }

  const retainedArchiveSeason = completedSeasons.length
    ? completedSeasons[completedSeasons.length - 1]
    : null;
  const archivesToPruneAfterActivation = retainedArchiveSeason === null
    ? []
    : completedSeasons.filter(season => season !== retainedArchiveSeason);

  return {
    ready: blocked.length === 0,
    reason: blocked.length ? 'SEASON_HISTORY_REQUIRES_RECONCILIATION' : null,
    skippedSeasons,
    completedSeasons,
    retainedArchiveSeason,
    archivesToPruneAfterActivation,
  };
}

/**
 * Detect the committed-but-not-finalized activation window.
 * Activation itself is atomic; cleanup is deliberately post-commit and may
 * need to be resumed by a later cron invocation after a process interruption.
 */
export function resolvePostActivationRetry(config: any) {
  const activeSeason = Number(config?.activeSeasonNumber || 0);
  const targetSeason = Number(config?.historyCleanupTargetSeason || 0);
  if (config?.historyCleanupPending !== true) {
    return { ready: false as const, reason: 'NO_PENDING_ACTIVATION_CLEANUP' };
  }
  if (!Number.isSafeInteger(activeSeason) || activeSeason < 2 ||
      !Number.isSafeInteger(targetSeason) || targetSeason !== activeSeason ||
      config?.worldReady !== true) {
    return { ready: false as const, reason: 'ACTIVATION_CLEANUP_STATE_INVALID' };
  }
  return { ready: true as const, sourceSeason: activeSeason - 1, targetSeason };
}


/**
 * Validate the durable skipped-season list written atomically with activation.
 * Cleanup retries use this marker to finish history status updates even if the
 * process stopped immediately after the activation transaction committed.
 */
export function resolveActivatedSkippedSeasons(skipped: any, targetSeason: number) {
  if (!Number.isSafeInteger(targetSeason) || targetSeason < 2) {
    return { ready: false as const, reason: 'SKIPPED_SEASON_TARGET_INVALID', seasons: [] as Array<{ seasonNumber: number; reason: string }> };
  }
  if (skipped === undefined || skipped === null) {
    return { ready: true as const, seasons: [] as Array<{ seasonNumber: number; reason: string }> };
  }
  if (!Array.isArray(skipped)) {
    return { ready: false as const, reason: 'SKIPPED_SEASON_LIST_INVALID', seasons: [] as Array<{ seasonNumber: number; reason: string }> };
  }
  const seen = new Set<number>();
  const seasons: Array<{ seasonNumber: number; reason: string }> = [];
  for (const item of skipped) {
    const seasonNumber = Number(item?.seasonNumber);
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1 || seasonNumber >= targetSeason || seen.has(seasonNumber)) {
      return { ready: false as const, reason: 'SKIPPED_SEASON_ENTRY_INVALID', seasons: [] as Array<{ seasonNumber: number; reason: string }> };
    }
    seen.add(seasonNumber);
    seasons.push({
      seasonNumber,
      reason: typeof item?.reason === 'string' && item.reason.trim()
        ? item.reason.trim()
        : 'SEASON_SKIPPED_DURING_RECOVERY',
    });
  }
  return { ready: true as const, seasons };
}


/**
 * Guard cleanup completion against a newer activation replacing the durable
 * cleanup target while an older worker is still finishing. A repeated
 * completion for the same target is harmless.
 */
export function resolveHistoryCleanupCompletion(config: any, targetSeason: number) {
  const activeSeason = Number(config?.activeSeasonNumber || 0);
  const cleanupTarget = Number(config?.historyCleanupTargetSeason || 0);
  if (!Number.isSafeInteger(targetSeason) || targetSeason < 2 ||
      activeSeason !== targetSeason || cleanupTarget !== targetSeason ||
      config?.worldReady !== true) {
    return { ready: false as const, reason: 'HISTORY_CLEANUP_TARGET_CHANGED', shouldMarkComplete: false };
  }
  return {
    ready: true as const,
    reason: null,
    shouldMarkComplete: config?.historyCleanupPending === true,
  };
}
