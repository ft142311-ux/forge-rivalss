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
