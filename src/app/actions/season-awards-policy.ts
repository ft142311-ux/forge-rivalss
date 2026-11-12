/**
 * Idempotency gate for season rewards.
 * The player marker and economy ledger are written in the same transaction;
 * either one is sufficient to prevent a retry from crediting the club twice.
 */
export function isSeasonAwardAlreadyApplied(
  player: any,
  transactionExists: boolean,
  sourceSeason: number,
): boolean {
  const season = Number(sourceSeason);
  if (!Number.isSafeInteger(season) || season < 1) return true;
  const awards = player?.seasonAwards && typeof player.seasonAwards === 'object'
    ? player.seasonAwards
    : {};
  return transactionExists === true || Boolean(awards[`S${season}`]);
}
