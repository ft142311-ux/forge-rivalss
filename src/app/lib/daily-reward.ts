export type DailyReward = { day: number; credits: number; crystals: number };

/** Returns the canonical daily reward for a calendar position (1–30). */
export function getDailyRewardForDay(day: number): DailyReward {
  const safeDay = Number.isInteger(day) && day >= 1 && day <= 30 ? day : 1;
  return {
    day: safeDay,
    credits: 100_000 + safeDay * 50_000,
    crystals: 10 + (safeDay % 7 === 0 ? 50 : 0),
  };
}

/** Premium grants an additional 50 crystals on every successful daily claim. */
export function getPremiumDailyCrystalBonus(isPremiumActive: boolean): number {
  return isPremiumActive ? 50 : 0;
}

/** rewardDay stores the last claimed day; the UI and next claim need the following day. */
export function getNextDailyRewardDay(lastClaimedDay: number | null | undefined, hasClaimedBefore: boolean): number {
  if (!hasClaimedBefore) return 1;
  const previousDay = Number(lastClaimedDay);
  const safePreviousDay = Number.isInteger(previousDay) && previousDay >= 0 ? previousDay : 0;
  return (safePreviousDay % 30) + 1;
}
