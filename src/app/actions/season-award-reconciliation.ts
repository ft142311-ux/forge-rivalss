export type SeasonAwardState =
  | 'AWARD_AND_LEDGER'
  | 'AWARD_WITHOUT_LEDGER'
  | 'LEDGER_WITHOUT_AWARD'
  | 'NEITHER';

/** Pure classifier for read-only reconciliation; it never performs a payout or repair. */
export function classifySeasonAwardState(award: unknown, ledger: unknown): SeasonAwardState {
  const hasAward = Boolean(award && typeof award === 'object');
  const hasLedger = Boolean(ledger && typeof ledger === 'object');
  if (hasAward && hasLedger) return 'AWARD_AND_LEDGER';
  if (hasAward) return 'AWARD_WITHOUT_LEDGER';
  if (hasLedger) return 'LEDGER_WITHOUT_AWARD';
  return 'NEITHER';
}
