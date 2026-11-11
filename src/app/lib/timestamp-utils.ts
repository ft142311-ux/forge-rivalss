/**
 * Converts supported Firestore and JavaScript date values to Unix milliseconds.
 * Invalid or unsupported values return NaN; callers retain their own fallback policy.
 */
export function timestampToMillis(value: any): number {
  if (value == null) return Number.NaN;

  if (typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : Number.NaN;
  }

  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    const millis = date instanceof Date ? date.getTime() : Number.NaN;
    return Number.isFinite(millis) ? millis : Number.NaN;
  }

  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);

  // Support Firestore timestamp-shaped objects after serialization.
  if (typeof value === 'object') {
    if (typeof value.seconds === 'number') {
      const nanoseconds = Number(value.nanoseconds || 0);
      return value.seconds * 1000 + nanoseconds / 1_000_000;
    }
    if (typeof value._seconds === 'number') {
      const nanoseconds = Number(value._nanoseconds || 0);
      return value._seconds * 1000 + nanoseconds / 1_000_000;
    }
  }

  return Number.NaN;
}
