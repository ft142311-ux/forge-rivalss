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


export type SeasonAwardRecipientResult = {
  settled: boolean;
  prize: number;
  trophy?: boolean;
  missingProfile?: boolean;
};

/**
 * Process recipients sequentially and derive a stable season-wide accounting
 * summary. A thrown error stops the pass; a retry replays recipients, while the
 * injected per-recipient transaction decides whether each reward is already settled.
 */
export async function applySeasonAwardRecipients<T>(
  recipients: T[],
  applyRecipient: (recipient: T) => Promise<SeasonAwardRecipientResult>,
) {
  let rewardedClubs = 0;
  let totalCredits = 0;
  let trophiesAwarded = 0;
  const missingProfileUids: string[] = [];

  for (const recipient of recipients) {
    const result = await applyRecipient(recipient);
    if (result.missingProfile) {
      const uid = String((recipient as any)?.uid || '');
      if (uid) missingProfileUids.push(uid);
      continue;
    }
    if (result.settled) {
      rewardedClubs++;
      totalCredits += Math.max(0, Math.floor(Number(result.prize) || 0));
      if (result.trophy) trophiesAwarded++;
    }
  }

  return {
    ready: missingProfileUids.length === 0,
    ...(missingProfileUids.length ? {
      reason: 'SEASON_AWARD_PLAYER_PROFILE_MISSING',
      missingProfileCount: missingProfileUids.length,
      missingProfileUids,
    } : {}),
    rewardedClubs,
    totalCredits,
    trophiesAwarded,
  };
}
