function timestampMillis(value: unknown): number | null {
  let candidate: unknown = value;

  if (candidate instanceof Date) {
    candidate = candidate.getTime();
  } else if (candidate !== null && typeof candidate === 'object') {
    const timestamp = candidate as { toMillis?: () => number; toDate?: () => Date };
    try {
      if (typeof timestamp.toMillis === 'function') {
        candidate = timestamp.toMillis();
      } else if (typeof timestamp.toDate === 'function') {
        candidate = timestamp.toDate().getTime();
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }

  if (typeof candidate === 'string') {
    if (candidate.trim() === '') return null;
    candidate = Number(candidate);
  }

  return typeof candidate === 'number' && Number.isSafeInteger(candidate)
    ? candidate
    : null;
}

export function getTournamentRegistrationWindow(tournament: any): { opensAt: number; closesAt: number } | null {
  if (!tournament || typeof tournament !== 'object') return null;

  const opensAt = timestampMillis(tournament.registrationOpenAt);
  const closesAt = timestampMillis(tournament.registrationCloseAt);
  if (opensAt === null || closesAt === null || closesAt <= opensAt) return null;

  return { opensAt, closesAt };
}

export function isTournamentRegistrationOpen(tournament: any, now = Date.now()): boolean {
  if (!tournament || tournament.status !== 'registration' || !Number.isSafeInteger(now)) return false;

  const window = getTournamentRegistrationWindow(tournament);
  return Boolean(window && now >= window.opensAt && now < window.closesAt);
}
