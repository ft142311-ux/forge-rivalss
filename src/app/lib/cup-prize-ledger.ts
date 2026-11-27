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
  if (typeof currentCredits !== 'number' ||
      !Number.isSafeInteger(currentCredits) ||
      currentCredits < 0 ||
      typeof rewardAmount !== 'number' ||
      !Number.isSafeInteger(rewardAmount) ||
      rewardAmount <= 0) {
    return null;
  }

  const balanceAfter = currentCredits + rewardAmount;
  if (!Number.isSafeInteger(balanceAfter)) return null;

  return { balanceBefore: currentCredits, balanceAfter };
}
