'use strict';

const INACTIVITY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Firebase Auth metadata is the source of truth for successful sign-ins.
 * Missing or malformed metadata must fail closed: never retire an account
 * when its last successful sign-in cannot be established.
 */
function toTimestampMs(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : NaN;
  }
  return NaN;
}

function resolveClubInactivity(lastSignInAt, nowMs = Date.now(), inactivityWindowMs = INACTIVITY_WINDOW_MS, lastActiveAt = null) {
  const authSignInMs = toTimestampMs(lastSignInAt);
  if (!Number.isFinite(authSignInMs) || !Number.isFinite(nowMs) ||
      !Number.isFinite(inactivityWindowMs) || inactivityWindowMs <= 0) {
    return { eligible: false, reason: 'LAST_SIGN_IN_UNKNOWN' };
  }

  // A verified in-app session may be newer than the Auth sign-in metadata.
  // It can postpone retirement, but it cannot replace missing Auth evidence.
  const hasAppActivity = lastActiveAt !== null && lastActiveAt !== undefined;
  const appActivityMs = hasAppActivity ? toTimestampMs(lastActiveAt) : NaN;
  if (hasAppActivity && !Number.isFinite(appActivityMs)) {
    return { eligible: false, reason: 'LAST_ACTIVITY_UNKNOWN' };
  }
  const lastSignInMs = Number.isFinite(appActivityMs)
    ? Math.max(authSignInMs, appActivityMs)
    : authSignInMs;

  if (lastSignInMs > nowMs) {
    return { eligible: false, reason: 'LAST_SIGN_IN_IN_FUTURE' };
  }

  const inactiveForMs = nowMs - lastSignInMs;
  // The policy is strictly "more than 90 days". At the exact boundary,
  // keep the club for one more sweep; this avoids retiring on day 90 itself.
  if (inactiveForMs <= inactivityWindowMs) {
    return { eligible: false, reason: 'USER_RECENTLY_ACTIVE', inactiveForMs };
  }

  return {
    eligible: true,
    reason: 'INACTIVE_OVER_THRESHOLD',
    inactiveForMs,
    inactiveSince: new Date(lastSignInMs).toISOString(),
    cutoff: new Date(nowMs - inactivityWindowMs).toISOString(),
  };
}

module.exports = { INACTIVITY_WINDOW_MS, resolveClubInactivity, toTimestampMs };
