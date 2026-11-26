/**
 * Canonical player skill keys shared by match simulation, Foundation,
 * training actions and UI adapters.
 *
 * Keep this list ordered: match calculations and compatibility consumers
 * rely on the established ten-skill set and order.
 */
export const PLAYER_SKILL_KEYS = [
  'lastHitting',
  'mapAwareness',
  'positioning',
  'reflexes',
  'manaManagement',
  'objectiveControl',
  'communication',
  'tiltResistance',
  'versatility',
  'ganking',
] as const;

export type PlayerSkillKey = typeof PLAYER_SKILL_KEYS[number];

const PLAYER_SKILL_KEY_SET: ReadonlySet<string> = new Set(PLAYER_SKILL_KEYS);

/** Runtime guard for untrusted player-skill values. */
export function isPlayerSkillKey(value: unknown): value is PlayerSkillKey {
  return typeof value === 'string' && PLAYER_SKILL_KEY_SET.has(value);
}
