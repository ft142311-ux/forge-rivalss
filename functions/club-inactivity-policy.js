'use strict';

const INACTIVITY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Firebase Auth metadata is the source of truth for successful sign-ins.
 * Missing or malformed metadata must fail closed: never retire an account
 * when its last successful sign-in cannot be established.
 */
function resolveClubInactivity(lastSignInAt, nowMs = Date.now(), inactivityWindowMs = INACTIVITY_WINDOW_MS) {
  const lastSignInMs = typeof lastSignInAt === 'number'
    ? lastSignInAt
    : lastSignInAt instanceof Date
      ? lastSignInAt.getTime()
      : typeof lastSignInAt === 'string'
        ? Date.parse(lastSignInAt)
        : NaN;

  if (!Number.isFinite(lastSignInMs) || !Number.isFinite(nowMs) ||
      !Number.isFinite(inactivityWindowMs) || inactivityWindowMs <= 0) {
    return { eligible: false, reason: 'LAST_SIGN_IN_UNKNOWN' };
  }

  if (lastSignInMs > nowMs) {
    return { eligible: false, reason: 'LAST_SIGN_IN_IN_FUTURE' };
  }

  const inactiveForMs = nowMs - lastSignInMs;
  if (inactiveForMs < inactivityWindowMs) {
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

module.exports = { INACTIVITY_WINDOW_MS, resolveClubInactivity };
