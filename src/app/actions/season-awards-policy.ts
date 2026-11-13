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


/** Persist the trophy array whenever either independent competition grants a trophy. */
export function shouldPersistSeasonTrophies(shouldAddLeagueCup: boolean, shouldAddPyramidCup: boolean): boolean {
  return shouldAddLeagueCup || shouldAddPyramidCup;
}


/** Resolve whether a reward recipient is safe to pay or already paid. */
export function resolveSeasonAwardRecipientState(
  playerExists: boolean,
  transactionExists: boolean,
  player: any,
  sourceSeason: number,
): 'ALREADY_APPLIED' | 'PROFILE_MISSING' | 'READY' {
  const season = Number(sourceSeason);
  if (!Number.isSafeInteger(season) || season < 1) return 'PROFILE_MISSING';
  if (transactionExists === true) return 'ALREADY_APPLIED';
  if (!playerExists) return 'PROFILE_MISSING';
  if (isSeasonAwardAlreadyApplied(player, false, season)) return 'ALREADY_APPLIED';
  return 'READY';
}

/**
 * Recovery carry-forward plans intentionally do not apply rewards or invent
 * results. Every ordinary rollover plan must carry an explicit completed
 * reward gate before it can be published or activated.
 */
export function isRolloverPlanPublicationReady(plan: any): boolean {
  if (!plan || plan.ready !== true) return false;
  if (plan.mode === 'recovery_carry_forward') return true;
  return plan.awards?.ready === true;
}
