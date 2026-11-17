import type { FoundationPlayerState } from './types';
import { calculateSalary } from './player-system';

export function calculateDailyPlayerSalary(players: FoundationPlayerState[]) {
  return players.reduce((sum, player) => {
    const salary = player.salary === undefined || player.salary === null || player.salary === '' || player.salary === 0
      ? calculateSalary(player)
      : Number(player.salary);
    if (!Number.isSafeInteger(salary) || salary < 0) throw new Error('FOUNDATION_SALARY_INVALID');
    const total = sum + salary;
    if (!Number.isSafeInteger(total)) throw new Error('FOUNDATION_SALARY_INVALID');
    return total;
  }, 0);
}

export function salaryPeriodKey(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`;
}
