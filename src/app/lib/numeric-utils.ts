/**
 * Shared numeric helpers used by deterministic game calculations.
 *
 * Keep this implementation behavior-identical to the former local clamp helpers.
 */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
