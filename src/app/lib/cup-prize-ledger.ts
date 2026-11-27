export type CupPrizeReceiptExpectation = {
  userId: string;
  amount: number;
  currency: 'credits';
  type: string;
  referenceId: string;
  division: number;
};

/**
 * Resolve an idempotent replay of a previously credited Cup reward.
 * Returning the original amount keeps the Cup completion summary consistent
 * when the ledger write committed but the final Cup-document write did not.
 */
export function resolveCupPrizeReplayAmount(
  receipt: unknown,
  expected: CupPrizeReceiptExpectation,
): number | null {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;

  const amount = Number(expected.amount);
  const division = Number(expected.division);
  if (!String(expected.userId || '').trim() ||
      !Number.isSafeInteger(amount) || amount <= 0 ||
      expected.currency !== 'credits' ||
      !String(expected.type || '').trim() ||
      !String(expected.referenceId || '').trim() ||
      !Number.isInteger(division) || division < 1 || division > 4) {
    return null;
  }

  const value = receipt as Record<string, unknown>;
  if (value.userId !== expected.userId ||
      value.amount !== amount ||
      value.currency !== expected.currency ||
      value.type !== expected.type ||
      value.referenceId !== expected.referenceId ||
      Number(value.division) !== division) {
    return null;
  }

  return amount;
}


export type CupPrizeBalance = {
  balanceBefore: number;
  balanceAfter: number;
};

/**
 * Resolve a safe balance update for a Cup prize.
 * Invalid legacy balances and integer overflow fail closed instead of
 * silently resetting a manager's credits to zero during settlement.
 */
export function resolveCupPrizeBalance(
  currentCredits: unknown,
  rewardAmount: unknown,
): CupPrizeBalance | null {
  // Match the canonical economy readers: absent legacy balances mean zero,
  // and integer strings remain readable during numeric-field migrations.
  let balanceBefore: number;
  if (currentCredits === undefined || currentCredits === null) {
    balanceBefore = 0;
  } else {
    if (typeof currentCredits !== 'number' && typeof currentCredits !== 'string') return null;
    if (typeof currentCredits === 'string' && currentCredits.trim().length === 0) return null;
    balanceBefore = Number(currentCredits);
  }
  if (!Number.isSafeInteger(balanceBefore) || balanceBefore < 0 ||
      typeof rewardAmount !== 'number' ||
      !Number.isSafeInteger(rewardAmount) ||
      rewardAmount <= 0) {
    return null;
  }

  const balanceAfter = balanceBefore + rewardAmount;
  if (!Number.isSafeInteger(balanceAfter)) return null;

  return { balanceBefore, balanceAfter };
}

export type CupPrizeTrophyState = {
  existingTrophies: unknown[];
  hasChampionTrophy: boolean;
};

/** Validate the trophy collection and detect the season's unique champion trophy. */
export function resolveCupPrizeTrophyState(
  trophies: unknown,
  season: unknown,
): CupPrizeTrophyState | null {
  const seasonNumber = Number(season);
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1 ||
      (trophies !== undefined && trophies !== null && !Array.isArray(trophies))) {
    return null;
  }
  const existingTrophies: unknown[] = Array.isArray(trophies) ? trophies : [];
  const trophyId = `pyramid-cup-season-${seasonNumber}`;
  const hasChampionTrophy = existingTrophies.some(item =>
    Boolean(item && typeof item === 'object' && !Array.isArray(item) &&
      (item as Record<string, unknown>).id === trophyId)
  );
  return { existingTrophies, hasChampionTrophy };
}
