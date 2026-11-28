import type { FoundationPlayerState } from './types';
import { calculateSalary } from './player-system';

/**
 * Resolve a persisted player salary without silently repairing corrupt values.
 * Missing and zero values remain compatible with legacy profiles; canonical
 * numeric strings are normalized to numbers. Negative, fractional, blank and
 * unsafe values fail closed before the daily cycle writes the roster.
 */
export function resolveFoundationPlayerSalary(player: FoundationPlayerState): number {
  const rawSalary: unknown = (player as unknown as { salary?: unknown }).salary;
  if (rawSalary === undefined || rawSalary === null || rawSalary === 0 || rawSalary === '0') {
    return calculateSalary(player);
  }

  if (typeof rawSalary === 'string') {
    if (!/^(?:0|[1-9]\d*)$/.test(rawSalary)) throw new Error('FOUNDATION_SALARY_INVALID');
    const parsed = Number(rawSalary);
    if (parsed === 0) return calculateSalary(player);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('FOUNDATION_SALARY_INVALID');
    return parsed;
  }

  if (typeof rawSalary !== 'number' || !Number.isSafeInteger(rawSalary) || rawSalary < 0) {
    throw new Error('FOUNDATION_SALARY_INVALID');
  }
  return rawSalary === 0 ? calculateSalary(player) : rawSalary;
}

export function calculateDailyPlayerSalary(players: FoundationPlayerState[]) {
  return players.reduce((sum, player) => {
    const salary = resolveFoundationPlayerSalary(player);
    const total = sum + salary;
    if (!Number.isSafeInteger(total)) throw new Error('FOUNDATION_SALARY_INVALID');
    return total;
  }, 0);
}

export function salaryPeriodKey(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`;
}
