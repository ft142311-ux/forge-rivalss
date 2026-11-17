/** Resolve a persisted training deadline without allowing malformed values to bypass readiness checks. */
export function resolveTrainingFinishTimeMs(value: unknown): number | null {
  const resolved = value && typeof (value as any).toMillis === 'function'
    ? (value as any).toMillis()
    : value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Date.parse(value)
          : NaN;
  return Number.isFinite(resolved) ? resolved : null;
}
