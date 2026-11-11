/** Resolve the winning participant without changing the caller's ID representation. */
export function getMatchWinnerId<T>(winnerSide: string | null | undefined, homeId: T, awayId: T): T | null {
  return winnerSide === 'home' ? homeId : winnerSide === 'away' ? awayId : null;
}
