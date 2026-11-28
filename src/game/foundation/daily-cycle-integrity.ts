/**
 * Canonical integrity checks for Foundation's daily event and payroll pair.
 *
 * The daily cron, event resolver and read action all consume the same persisted
 * event contract. Payroll markers and receipts are written in one Firestore
 * transaction; a retry verifies both before treating the day as complete.
 */

export interface FoundationDailyEventRecord {
  userId: string;
  date: string;
  event: {
    id: string;
    title: string;
    description: string;
    effects: Record<string, number>;
  };
  applied?: boolean;
  resolvedAt?: unknown;
  resolved?: 'accept' | 'decline';
}

type DataRecord = Record<string, unknown>;

function isRecord(value: unknown): value is DataRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestampLike(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value === 'string') return Number.isFinite(Date.parse(value));
  if (typeof value === 'number') return Number.isFinite(value);
  if (isRecord(value) && typeof value.toDate === 'function') {
    try {
      const date = (value.toDate as () => unknown)();
      return date instanceof Date && Number.isFinite(date.getTime());
    } catch {
      return false;
    }
  }
  return false;
}

function invalidEvent(): never {
  throw new Error('FOUNDATION_EVENT_RECORD_INVALID');
}

/**
 * Validate ownership, date, event payload and the resolution state machine.
 * An unresolved event may not already have applied effects. A resolved event
 * must carry a valid choice and a matching applied flag.
 */
export function assertFoundationDailyEventRecord(
  value: unknown,
  expectedUserId: string,
  expectedDate: string,
): FoundationDailyEventRecord {
  if (!isRecord(value) || value.userId !== expectedUserId || value.date !== expectedDate) {
    return invalidEvent();
  }

  const event = value.event;
  if (!isRecord(event)) return invalidEvent();
  if (
    typeof event.id !== 'string' ||
    !event.id ||
    event.id.trim() !== event.id ||
    event.id.length > 128 ||
    typeof event.title !== 'string' ||
    !event.title.trim() ||
    typeof event.description !== 'string' ||
    !event.description.trim() ||
    !isRecord(event.effects)
  ) {
    return invalidEvent();
  }

  for (const effect of Object.values(event.effects)) {
    if (typeof effect !== 'number' || !Number.isFinite(effect)) return invalidEvent();
  }

  const hasResolvedAt = value.resolvedAt !== undefined && value.resolvedAt !== null;
  if (hasResolvedAt) {
    if (!isTimestampLike(value.resolvedAt)) return invalidEvent();
    if (value.resolved !== 'accept' && value.resolved !== 'decline') return invalidEvent();
    if (typeof value.applied !== 'boolean' || value.applied !== (value.resolved === 'accept')) {
      return invalidEvent();
    }
  } else if (
    (value.resolved !== undefined && value.resolved !== null) ||
    value.applied === true ||
    (value.applied !== undefined && value.applied !== false)
  ) {
    return invalidEvent();
  }

  return value as unknown as FoundationDailyEventRecord;
}

function requireNonNegativeSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
  }
  return value;
}

/**
 * Verify that a daily cycle marker and its economy receipt describe exactly
 * the same debit. Optional marker fields support records written before the
 * marker began storing the derived unpaid/amountDue values.
 */
export function assertFoundationDailyPayrollLedger(
  cycleValue: unknown,
  receiptValue: unknown,
  expectedUserId: string,
  expectedDate: string,
): true {
  if (!isRecord(cycleValue) || !isRecord(receiptValue)) {
    throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
  }

  const cycle = cycleValue;
  const receipt = receiptValue;
  if (
    cycle.userId !== expectedUserId ||
    cycle.date !== expectedDate ||
    receipt.userId !== expectedUserId ||
    receipt.periodKey !== expectedDate ||
    receipt.type !== 'DAILY_SALARY' ||
    receipt.currency !== 'credits'
  ) {
    throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
  }

  const cyclePaid = requireNonNegativeSafeInteger(cycle.paid);
  const cyclePlayerSalary = requireNonNegativeSafeInteger(cycle.playerSalary);
  const cycleStaffSalary = requireNonNegativeSafeInteger(cycle.staffSalary);
  const paid = requireNonNegativeSafeInteger(receipt.paid);
  const unpaid = requireNonNegativeSafeInteger(receipt.unpaid);
  const playerSalary = requireNonNegativeSafeInteger(receipt.playerSalary);
  const staffSalary = requireNonNegativeSafeInteger(receipt.staffSalary);
  const amountDue = requireNonNegativeSafeInteger(receipt.amountDue);
  const balanceBefore = requireNonNegativeSafeInteger(receipt.balanceBefore);
  const balanceAfter = requireNonNegativeSafeInteger(receipt.balanceAfter);

  const expectedAmountDue = playerSalary + staffSalary;
  const expectedPaidAndUnpaid = paid + unpaid;
  if (
    !Number.isSafeInteger(expectedAmountDue) ||
    !Number.isSafeInteger(expectedPaidAndUnpaid) ||
    cyclePaid !== paid ||
    cyclePlayerSalary !== playerSalary ||
    cycleStaffSalary !== staffSalary ||
    amountDue !== expectedAmountDue ||
    expectedPaidAndUnpaid !== amountDue ||
    paid > amountDue ||
    unpaid !== amountDue - paid ||
    balanceBefore < paid ||
    balanceAfter !== balanceBefore - paid ||
    receipt.amount !== -paid
  ) {
    throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
  }

  if (
    (cycle.amountDue !== undefined && cycle.amountDue !== amountDue) ||
    (cycle.unpaid !== undefined && cycle.unpaid !== unpaid)
  ) {
    throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
  }

  for (const eventId of [cycle.eventId, receipt.eventId]) {
    if (
      eventId !== undefined &&
      eventId !== null &&
      (typeof eventId !== 'string' || !eventId || eventId.trim() !== eventId || eventId.length > 128)
    ) {
      throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
    }
  }
  if (
    cycle.eventId !== undefined &&
    receipt.eventId !== undefined &&
    cycle.eventId !== receipt.eventId
  ) {
    throw new Error('FOUNDATION_PAYROLL_LEDGER_MISMATCH');
  }

  return true;
}
