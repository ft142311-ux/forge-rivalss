/**
 * Tournament match processing uses a bounded lease so a crashed worker can be
 * recovered by the next cycle. Invalid timestamps fail closed: they are never
 * treated as proof that another worker's lease has expired.
 */
export const TOURNAMENT_MATCH_LEASE_MS = 5 * 60 * 1000;

export function isTournamentMatchLeaseExpired(
  processingAt: unknown,
  nowMs: number,
  leaseMs = TOURNAMENT_MATCH_LEASE_MS,
): boolean {
  let startedAtMs = Number.NaN;
  if (processingAt instanceof Date) {
    startedAtMs = processingAt.getTime();
  } else if (typeof processingAt === 'number') {
    startedAtMs = processingAt;
  } else if (typeof processingAt === 'string') {
    startedAtMs = Date.parse(processingAt);
  } else if (processingAt && typeof processingAt === 'object') {
    const value = processingAt as { toMillis?: () => number; toDate?: () => Date };
    if (typeof value.toMillis === 'function') {
      try { startedAtMs = value.toMillis(); } catch { return false; }
    } else if (typeof value.toDate === 'function') {
      try { startedAtMs = value.toDate().getTime(); } catch { return false; }
    }
  }

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(leaseMs)) {
    return false;
  }
  const ageMs = nowMs - startedAtMs;
  return ageMs >= leaseMs && ageMs >= 0;
}
