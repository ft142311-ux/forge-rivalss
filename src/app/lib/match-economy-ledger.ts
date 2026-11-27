export type MatchEconomyReceiptExpectation = {
  userId: string;
  matchId: string;
  amount: number;
};

function readReceiptInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * A match-revenue receipt proves that its balance credit committed atomically.
 * Legacy receipts without snapshots remain valid; partial or inconsistent
 * snapshots must not suppress a retry or hide a reused idempotency key.
 */
export function isValidMatchEconomyReceipt(
  receipt: unknown,
  expected: MatchEconomyReceiptExpectation,
): boolean {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (typeof expected.userId !== 'string' || !expected.userId.trim() ||
      typeof expected.matchId !== 'string' || !expected.matchId.trim() ||
      !Number.isSafeInteger(expected.amount) || expected.amount < 0) {
    return false;
  }

  const value = receipt as Record<string, unknown>;
  if (value.userId !== expected.userId ||
      value.referenceId !== expected.matchId ||
      value.currency !== 'credits' ||
      value.type !== 'MATCH_REVENUE' ||
      readReceiptInteger(value.amount) !== expected.amount) {
    return false;
  }

  const hasBalanceBefore = Object.prototype.hasOwnProperty.call(value, 'balanceBefore');
  const hasBalanceAfter = Object.prototype.hasOwnProperty.call(value, 'balanceAfter');
  if (hasBalanceBefore !== hasBalanceAfter) return false;
  if (!hasBalanceBefore) return true;

  const balanceBefore = readReceiptInteger(value.balanceBefore);
  const balanceAfter = readReceiptInteger(value.balanceAfter);
  if (balanceBefore === null || balanceAfter === null) return false;
  const expectedBalanceAfter = balanceBefore + expected.amount;
  return Number.isSafeInteger(expectedBalanceAfter) && balanceAfter === expectedBalanceAfter;
}
