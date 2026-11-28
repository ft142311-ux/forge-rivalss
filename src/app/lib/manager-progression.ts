import { getLevelThreshold } from './time-utils';

export type ManagerXpSource = 'daily_reward' | 'league_match' | 'pyramid_cup_match' | 'tournament_match';
export type ManagerCompetition = 'league' | 'pyramid_cup' | 'tournament';

export const MANAGER_XP_REWARDS = {
  dailyReward: 25,
  leagueMatch: 100,
  leagueWinBonus: 50,
  pyramidCupMatch: 120,
  pyramidCupWinBonus: 60,
  tournamentMatch: 75,
  tournamentWinBonus: 40,
} as const;

export type ManagerProfileProgress = {
  managerLevel?: unknown;
  experiencePoints?: unknown;
};

function readSafeInteger(value: unknown, fallback: number, minimum: number, code: string): number {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(code);
  }
  return parsed;
}

function readManagerProgress(profile: ManagerProfileProgress) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('MANAGER_PROGRESS_INVALID');
  }
  return {
    managerLevel: readSafeInteger(profile.managerLevel, 1, 1, 'MANAGER_PROGRESS_INVALID'),
    experiencePoints: readSafeInteger(profile.experiencePoints, 0, 0, 'MANAGER_PROGRESS_INVALID'),
  };
}

/**
 * XP is progress within the current manager level. Each level consumes its own
 * threshold, preserving the existing profile contract and getLevelThreshold UI.
 */
export function calculateManagerProgress(profile: ManagerProfileProgress, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('MANAGER_XP_AMOUNT_INVALID');
  }
  const current = readManagerProgress(profile);
  let managerLevel = current.managerLevel;
  let experiencePoints = current.experiencePoints + amount;
  if (!Number.isSafeInteger(experiencePoints)) throw new Error('MANAGER_XP_OVERFLOW');

  while (managerLevel < 1000) {
    const threshold = getLevelThreshold(managerLevel);
    if (!Number.isSafeInteger(threshold) || threshold <= 0 || experiencePoints < threshold) break;
    experiencePoints -= threshold;
    managerLevel += 1;
  }

  return {
    levelBefore: current.managerLevel,
    experienceBefore: current.experiencePoints,
    managerLevel,
    experiencePoints,
    levelsGained: managerLevel - current.managerLevel,
    amount,
  };
}

export function createManagerXpAward(
  profile: ManagerProfileProgress,
  amount: number,
  source: ManagerXpSource,
) {
  const progress = calculateManagerProgress(profile, amount);
  return {
    profilePatch: {
      managerLevel: progress.managerLevel,
      experiencePoints: progress.experiencePoints,
    },
    receipt: {
      source,
      amount: progress.amount,
      levelBefore: progress.levelBefore,
      levelAfter: progress.managerLevel,
      xpBefore: progress.experienceBefore,
      xpAfter: progress.experiencePoints,
      levelsGained: progress.levelsGained,
    },
  };
}

export function getManagerMatchXp(competition: ManagerCompetition, won: boolean): number {
  switch (competition) {
    case 'league':
      return MANAGER_XP_REWARDS.leagueMatch + (won ? MANAGER_XP_REWARDS.leagueWinBonus : 0);
    case 'pyramid_cup':
      return MANAGER_XP_REWARDS.pyramidCupMatch + (won ? MANAGER_XP_REWARDS.pyramidCupWinBonus : 0);
    case 'tournament':
      return MANAGER_XP_REWARDS.tournamentMatch + (won ? MANAGER_XP_REWARDS.tournamentWinBonus : 0);
  }
}

export function isEligibleManagerProfile(uid: string, profile: unknown): boolean {
  if (!uid || /^bot(?:_|-)/i.test(uid)) return false;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const data = profile as Record<string, unknown>;
  return data.isBot !== true && data.isHuman !== false && data.kind !== 'bot';
}

export function getManagerProgressDisplay(managerLevel: unknown, experiencePoints: unknown) {
  const progress = readManagerProgress({ managerLevel, experiencePoints });
  const rawThreshold = getLevelThreshold(progress.managerLevel);
  const threshold = Number.isSafeInteger(rawThreshold) && rawThreshold > 0
    ? rawThreshold
    : Number.MAX_SAFE_INTEGER;
  return {
    ...progress,
    threshold,
    remaining: Math.max(0, threshold - progress.experiencePoints),
    percent: Math.max(0, Math.min(100, (progress.experiencePoints / threshold) * 100)),
  };
}
