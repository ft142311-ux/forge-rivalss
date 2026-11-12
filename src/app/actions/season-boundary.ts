/**
 * Pure season-boundary policy.
 * A delayed scheduler may advance only one season per invocation so each
 * intermediate season must pass through its own archive/readiness/publication gate.
 */
export function advanceAtMostOneSeasonBoundary(
  seasonNumber: number,
  seasonStart: Date,
  nextBoundary: Date,
  now: Date,
  cadenceDays: number,
) {
  const validSeason = Number.isSafeInteger(seasonNumber) && seasonNumber >= 1;
  const startMs = seasonStart instanceof Date ? seasonStart.getTime() : NaN;
  const boundaryMs = nextBoundary instanceof Date ? nextBoundary.getTime() : NaN;
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  const cadence = Number(cadenceDays);
  if (!validSeason || !Number.isFinite(startMs) || !Number.isFinite(boundaryMs) || !Number.isFinite(nowMs) || !Number.isFinite(cadence) || cadence <= 0) {
    throw new Error('INVALID_SEASON_BOUNDARY_INPUT');
  }
  if (nowMs < boundaryMs) {
    return { seasonNumber, seasonStart: new Date(startMs), nextBoundary: new Date(boundaryMs), advanced: false };
  }
  const newStart = new Date(boundaryMs);
  return {
    seasonNumber: seasonNumber + 1,
    seasonStart: newStart,
    nextBoundary: new Date(boundaryMs + cadence * 24 * 60 * 60 * 1000),
    advanced: true,
  };
}


/** Clamp any persisted/requested target to the immediate successor only. */
export function resolveNextSeasonTarget(activeSeasonNumber: number, requestedTarget: number) {
  if (!Number.isSafeInteger(activeSeasonNumber) || activeSeasonNumber < 1) {
    throw new Error('INVALID_ACTIVE_SEASON_NUMBER');
  }
  if (!Number.isFinite(requestedTarget) || requestedTarget < 0) {
    throw new Error('INVALID_REQUESTED_SEASON_TARGET');
  }
  // Requested target is intentionally not allowed to skip a season, even if
  // a stale config says S3 while S1 is still active.
  return activeSeasonNumber + 1;
}

/** A missed-date catch-up may still prepare only the immediate successor. */
export function canPrepareImmediateCatchUpTarget(
  activeSeasonNumber: number,
  targetSeasonNumber: number,
  missedSeasonArchivesReady: boolean,
) {
  return Number.isSafeInteger(activeSeasonNumber) && activeSeasonNumber >= 1 &&
    targetSeasonNumber === activeSeasonNumber + 1 && missedSeasonArchivesReady === true;
}


/**
 * Resolve the date window used by the calendar readiness gate. The clean local
 * emulator reset intentionally creates a fresh Season 1 start at the next 18:00
 * MSK boundary and schedules its first boundary 17 days later. That generated
 * window is authoritative only for the explicit CLEAN_S1_V1 marker; production
 * and legacy worlds continue to use the canonical historical dates.
 */
export function resolveCanonicalSeasonDateWindow(input: {
  worldGeneration?: unknown;
  activeSeasonNumber: number;
  persistedSeasonStart?: Date | null;
  persistedNextSeasonStart?: Date | null;
  canonicalSeasonStart: Date;
  canonicalNextSeasonStart: Date;
}) {
  const start = input.persistedSeasonStart;
  const next = input.persistedNextSeasonStart;
  const localWindowValid = input.worldGeneration === 'CLEAN_S1_V1' &&
    input.activeSeasonNumber === 1 && start instanceof Date && next instanceof Date &&
    Number.isFinite(start.getTime()) && Number.isFinite(next.getTime()) &&
    next.getTime() - start.getTime() === 17 * 24 * 60 * 60 * 1000;

  return localWindowValid
    ? { seasonStart: new Date(start!.getTime()), nextSeasonStart: new Date(next!.getTime()), source: 'CLEAN_S1_V1' as const }
    : { seasonStart: new Date(input.canonicalSeasonStart.getTime()), nextSeasonStart: new Date(input.canonicalNextSeasonStart.getTime()), source: 'CANONICAL' as const };
}

export type SeasonWindow = {
  seasonNumber: number;
  seasonStart: Date;
  nextSeasonStart: Date;
  status: 'scheduled' | 'active' | 'completed';
};

/**
 * Derive the complete sequence from a persisted season boundary using UTC and
 * half-open windows: a season is active at its start instant, and the prior
 * season is completed at that exact instant. No writes or implicit date shifts.
 */
export function deriveSeasonDatePlan(
  activeSeasonNumber: number,
  seasonStart: Date,
  nextSeasonStart: Date,
  now: Date,
  cadenceDays: number,
) {
  const activeValid = Number.isSafeInteger(activeSeasonNumber) && activeSeasonNumber >= 1;
  const startMs = seasonStart instanceof Date ? seasonStart.getTime() : NaN;
  const nextMs = nextSeasonStart instanceof Date ? nextSeasonStart.getTime() : NaN;
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  const cadenceMs = Number(cadenceDays) * 24 * 60 * 60 * 1000;
  if (!activeValid || !Number.isFinite(startMs) || !Number.isFinite(nextMs) ||
      !Number.isFinite(nowMs) || !Number.isFinite(cadenceMs) || cadenceMs <= 0 || nextMs <= startMs) {
    throw new Error('INVALID_SEASON_DATE_PLAN');
  }

  const seasons: SeasonWindow[] = [];
  let seasonNumber = activeSeasonNumber;
  let start = startMs;
  let boundary = nextMs;
  for (let count = 0; count < 1000; count++) {
    const status: SeasonWindow['status'] = nowMs < start
      ? 'scheduled'
      : nowMs < boundary
        ? 'active'
        : 'completed';
    seasons.push({
      seasonNumber,
      seasonStart: new Date(start),
      nextSeasonStart: new Date(boundary),
      status,
    });
    if (status !== 'completed') {
      return {
        persistedActiveSeasonNumber: activeSeasonNumber,
        expectedSeasonNumber: seasonNumber,
        expectedSeasonStart: new Date(start),
        expectedNextSeasonStart: new Date(boundary),
        seasons,
        completedSeasons: seasons.filter(item => item.status === 'completed').map(item => item.seasonNumber),
      };
    }
    seasonNumber++;
    start = boundary;
    boundary += cadenceMs;
  }
  throw new Error('SEASON_DATE_PLAN_LIMIT_EXCEEDED');
}

/** Read-only gate for seasons that have elapsed while the active marker lagged. */
export function evaluateExpiredSeasonArchives(
  plan: ReturnType<typeof deriveSeasonDatePlan>,
  archiveStates: Record<number, { valid: boolean; reason?: string; duplicateMatches?: number; slotConflicts?: number }>,
) {
  const missed = plan.completedSeasons.filter(season => season > plan.persistedActiveSeasonNumber);
  const invalid = missed.filter(season => archiveStates[season]?.valid !== true ||
    Number(archiveStates[season]?.duplicateMatches || 0) > 0 || Number(archiveStates[season]?.slotConflicts || 0) > 0);
  if (invalid.length) {
    const invalidArchives = invalid.some(season => archiveStates[season]?.reason === 'ARCHIVE_INVALID');
    const integrityConflict = invalid.some(season => Number(archiveStates[season]?.duplicateMatches || 0) > 0 || Number(archiveStates[season]?.slotConflicts || 0) > 0);
    return {
      ready: false,
      reason: integrityConflict ? 'MISSED_SEASON_INTEGRITY_CONFLICT' : invalidArchives ? 'MISSED_SEASON_ARCHIVE_INVALID' : 'MISSED_SEASON_ARCHIVE_MISSING',
      missedSeasons: missed,
      invalidSeasons: invalid,
      writesStarted: false,
    };
  }
  return { ready: true, reason: null, missedSeasons: missed, invalidSeasons: [], writesStarted: false };
}

/**
 * Resolve the season transition window without changing the persisted calendar.
 * Day 15 starts 14 days after the active season begins (18:00 MSK). The
 * publication deadline is 22 hours later (16:00 MSK on that offseason day),
 * while activation remains pinned to the separately persisted next-season
 * boundary. This intentionally preserves the historical 17-day S1 -> S2 window.
 */
export function resolveSeasonLifecycleWindow(input: {
  seasonStart: Date | string | number | { toDate?: () => Date };
  nextSeasonStart: Date | string | number | { toDate?: () => Date };
  now: Date;
}) {
  const asDate = (value: unknown): Date => {
    if (value instanceof Date) return new Date(value.getTime());
    if (value && typeof value === 'object' && 'toDate' in value && typeof (value as any).toDate === 'function') {
      const converted = (value as any).toDate();
      return converted instanceof Date ? new Date(converted.getTime()) : new Date(NaN);
    }
    return new Date(value as string | number);
  };
  const seasonStart = asDate(input.seasonStart);
  const nextSeasonStart = asDate(input.nextSeasonStart);
  const now = input.now instanceof Date ? new Date(input.now.getTime()) : new Date(NaN);
  const startMs = seasonStart.getTime();
  const nextMs = nextSeasonStart.getTime();
  const nowMs = now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const durationDays = (nextMs - startMs) / dayMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(nextMs) || !Number.isFinite(nowMs) ||
      ![15, 17].includes(durationDays)) {
    throw new Error('INVALID_SEASON_LIFECYCLE_WINDOW');
  }
  const offseasonStartAt = new Date(startMs + 14 * dayMs);
  const finalizationAt = new Date(offseasonStartAt.getTime() - 2 * 60 * 60 * 1000);
  const lastRoundStartAt = new Date(startMs + 13 * dayMs);
  const offseasonDayEndsAt = new Date(offseasonStartAt.getTime() + dayMs);
  const publicationDeadlineAt = new Date(offseasonStartAt.getTime() + 22 * 60 * 60 * 1000);
  const activationAt = new Date(nextMs);
  return {
    finalizationAt,
    lastRoundStartAt,
    offseasonStartAt,
    offseasonDayEndsAt,
    publicationDeadlineAt,
    activationAt,
    offseasonActive: nowMs >= offseasonStartAt.getTime() && nowMs < nextMs,
    leagueMatchesPaused: nowMs >= offseasonStartAt.getTime(),
    publicationDeadlinePassed: nowMs > publicationDeadlineAt.getTime(),
    activationDue: nowMs >= nextMs,
  };
}