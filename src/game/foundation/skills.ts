import { isPlayerSkillKey, PLAYER_SKILL_KEYS } from '../player-skills';
import type { TrainingSkill } from './types';

/** Backwards-compatible Foundation export backed by the shared player-skill domain. */
export const FOUNDATION_SKILLS = PLAYER_SKILL_KEYS;

/** Runtime validation for untrusted training-focus values. */
export function isFoundationSkill(value: unknown): value is TrainingSkill {
  return isPlayerSkillKey(value);
}
