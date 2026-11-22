'use strict';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function timestampToMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value.toMillis === 'function') {
    try {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  if (typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      const millis = date instanceof Date ? date.getTime() : NaN;
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Missing, malformed, or future timestamps fail closed to offline. */
function isManagerOnline(lastSeen, now = Date.now()) {
  const seenAt = timestampToMillis(lastSeen);
  if (!Number.isFinite(now) || seenAt == null || seenAt > now) return false;
  return now - seenAt <= ONLINE_WINDOW_MS;
}

module.exports = { ONLINE_WINDOW_MS, isManagerOnline, timestampToMillis };
