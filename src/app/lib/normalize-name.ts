/**
 * Normalizes manager or club display names consistently across match flows.
 * Keeps the existing fallback and 40-character limit semantics.
 */
export function normalizeName(value: unknown, fallback = 'Manager'): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 40)
    : fallback;
}
