import type { FoundationPlayerState } from './types';
import { calculateSalary } from './player-system';

export function calculateDailyPlayerSalary(players: FoundationPlayerState[]) {
  return players.reduce((sum, player) => sum + Math.max(0, Number(player.salary || calculateSalary(player))), 0);
}

export function salaryPeriodKey(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`;
}
