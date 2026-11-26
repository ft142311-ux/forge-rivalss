import { PLAYER_SKILL_KEYS } from '../../game/player-skills';

/**
 * Canonical player skill keys shared by roster, dossier and transfer views.
 * Keep this export for backwards compatibility; the source list lives in
 * game/player-skills.ts and is shared by simulation and Foundation validation.
 */
export const STAT_KEYS = PLAYER_SKILL_KEYS;
