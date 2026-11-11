import { clamp } from './player-system';
import type { FoundationPlayerState } from './types';

/**
 * Synergy is based only on official club matches played together.
 * Friendlies and tournaments must not increase chemistryMatches.
 */
export function calculatePlayerSynergy(player: FoundationPlayerState) {
  const matches = Math.max(0, Number(player.chemistryMatches ?? 0));
  return clamp((matches / 20) * 100);
}

export function calculateTeamSynergy(players: FoundationPlayerState[]) {
  if (!players.length) return 0;
  return players.reduce((sum, player) => sum + calculatePlayerSynergy(player), 0) / players.length;
}

/**
 * Individual effectiveness penalty before 20 official club matches.
 * At 20 matches the penalty reaches 1.00. This does not modify the
 * displayed player rating; it is used only by the match engine.
 */
export function synergyMultiplier(synergy: number) {
  return clamp(.84 + clamp(synergy) / 625, .84, 1);
}
