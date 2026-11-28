/**
 * Idempotency gate for season rewards.
 * The player marker and economy ledger are written in the same transaction.
 * Both must agree before a recipient is treated as already settled; a split
 * marker is an accounting conflict and must block rollover completion.
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


/** Resolve a safe season-reward balance update; invalid data and overflow fail closed. */
export function resolveSeasonAwardBalance(currentCredits: unknown, rewardAmount: unknown): {
  balanceBefore: number;
  balanceAfter: number;
} | null {
  let balanceBefore: number;
  if (currentCredits === undefined || currentCredits === null) {
    balanceBefore = 0;
  } else {
    if (typeof currentCredits !== 'number' && typeof currentCredits !== 'string') return null;
    if (typeof currentCredits === 'string' && currentCredits.trim().length === 0) return null;
    balanceBefore = Number(currentCredits);
  }

  if (!Number.isSafeInteger(balanceBefore) || balanceBefore < 0 ||
      typeof rewardAmount !== 'number' || !Number.isSafeInteger(rewardAmount) || rewardAmount <= 0) {
    return null;
  }
  const balanceAfter = balanceBefore + rewardAmount;
  if (!Number.isSafeInteger(balanceAfter)) return null;
  return { balanceBefore, balanceAfter };
}


export type SeasonAwardTrophyState = {
  existingTrophies: unknown[];
  shouldAddLeagueCup: boolean;
  shouldAddPyramidCup: boolean;
  needsRepair: boolean;
};

/**
 * Validate the trophy collection and normalize only this season's two canonical
 * awards. Unrelated trophies are preserved byte-for-byte; malformed collection
 * shapes fail closed rather than being replaced with an empty array.
 */
export function resolveSeasonAwardTrophyState(
  trophies: unknown,
  sourceSeason: unknown,
  prize: unknown,
  isChampion: boolean,
  isPyramidWinner: boolean,
): SeasonAwardTrophyState | null {
  const season = Number(sourceSeason);
  if (!Number.isSafeInteger(season) || season < 1 ||
      (typeof prize !== 'number' || !Number.isSafeInteger(prize) || prize <= 0) ||
      (trophies !== undefined && trophies !== null && !Array.isArray(trophies))) {
    return null;
  }

  const existing = Array.isArray(trophies) ? trophies : [];
  const leagueId = `league-cup-season-${season}`;
  const pyramidId = `pyramid-cup-season-${season}`;
  const leagueName = `Кубок лиги — сезон ${season}`;
  const pyramidName = `Кубок Пирамиды — сезон ${season}`;
  const normalized: unknown[] = [];
  let hasLeague = false;
  let hasPyramid = false;
  let needsRepair = false;

  for (const item of existing) {
    const record = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : null;
    const id = record?.id;
    if (id !== leagueId && id !== pyramidId) {
      normalized.push(item);
      continue;
    }

    const dateMs = typeof record?.date === 'string' ? Date.parse(record.date) : NaN;
    const canonicalLeague = id === leagueId &&
      record?.name === leagueName &&
      record?.type === 'league_champion' &&
      Number(record?.season) === season &&
      Number(record?.division) === 1 &&
      Number(record?.rank) === 1 &&
      Number(record?.reward) === prize &&
      Number.isFinite(dateMs);
    const canonicalPyramid = id === pyramidId &&
      record?.name === pyramidName &&
      record?.type === 'pyramid_cup_champion' &&
      Number(record?.season) === season &&
      Number.isFinite(dateMs);

    if (canonicalLeague && !hasLeague) {
      normalized.push(item);
      hasLeague = true;
    } else if (canonicalPyramid && !hasPyramid) {
      normalized.push(item);
      hasPyramid = true;
    } else {
      needsRepair = true;
    }
  }

  return {
    existingTrophies: normalized,
    shouldAddLeagueCup: Boolean(isChampion && !hasLeague),
    shouldAddPyramidCup: Boolean(isPyramidWinner && !hasPyramid),
    needsRepair,
  };
}


/** Resolve whether a reward recipient is safe to pay or already paid. */
export function resolveSeasonAwardRecipientState(
  playerExists: boolean,
  transactionExists: boolean,
  player: any,
  sourceSeason: number,
): 'ALREADY_APPLIED' | 'PROFILE_MISSING' | 'ACCOUNTING_CONFLICT' | 'READY' {
  const season = Number(sourceSeason);
  if (!Number.isSafeInteger(season) || season < 1) return 'PROFILE_MISSING';
  if (!playerExists) return transactionExists === true ? 'ALREADY_APPLIED' : 'PROFILE_MISSING';

  const rawAwards = player?.seasonAwards;
  if (rawAwards !== undefined && rawAwards !== null &&
      (typeof rawAwards !== 'object' || Array.isArray(rawAwards))) return 'ACCOUNTING_CONFLICT';
  const awards = rawAwards || {};
  const marker = awards[`S${season}`];
  if (marker !== undefined && marker !== null &&
      (typeof marker !== 'object' || Array.isArray(marker))) return 'ACCOUNTING_CONFLICT';
  const hasAwardMarker = Boolean(marker);
  const hasLedger = transactionExists === true;
  if (hasAwardMarker && hasLedger) return 'ALREADY_APPLIED';
  if (hasAwardMarker !== hasLedger) return 'ACCOUNTING_CONFLICT';
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
