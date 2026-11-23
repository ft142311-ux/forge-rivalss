'use strict';

const { FieldValue } = require('firebase-admin/firestore');

/**
 * Login/activity fence shared by the app handshake and inactivity retirement.
 *
 * The retirement claimant reads user_activity_v1/{uid} and creates
 * inactive_club_retirements_v1/{uid} in one Firestore transaction. This
 * handshake reads that same pending marker and writes the activity document in
 * one transaction. Firestore serializes the competing transactions:
 * - activity commits first => retirement retries and sees a fresh timestamp;
 * - retirement claim commits first => activity retries and sees the marker.
 */
async function recordUserActivityUnlessRetiring(db, uid, nowMs = Date.now()) {
  if (!db || !uid) return { success: false, error: 'INVALID_ACTIVITY_CONTEXT' };

  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const retiredRef = db.collection('inactive_clubs_v1').doc(uid);
  const activityRef = db.collection('user_activity_v1').doc(uid);

  const startedAt = Date.now();
  console.info('[ACTIVITY FENCE TRACE]', { stage: 'transaction_started' });
  try {
    const result = await db.runTransaction(async (transaction) => {
      const readStartedAt = Date.now();
      const [pending, retired, activity] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(retiredRef),
        transaction.get(activityRef),
      ]);
      console.info('[ACTIVITY FENCE TRACE]', { stage: 'transaction_reads_completed', durationMs: Date.now() - readStartedAt, pending: pending.exists, retired: retired.exists, activity: activity.exists });

      // CANCELLED is a recoverable cleanup state, not permission to remove the
    // fence. The Auth account may still be disabled if the previous worker
    // crashed between marking cancellation and re-enabling it. Only the sweep
    // may re-enable Auth and then remove this marker.
      if (pending.exists) {
        console.warn('[ACTIVITY FENCE TRACE]', { stage: 'blocked_retiring' });
        return { success: false, error: 'ACCOUNT_RETIRING' };
      }
      if (retired.exists) {
        console.warn('[ACTIVITY FENCE TRACE]', { stage: 'blocked_retired' });
        return { success: false, error: 'ACCOUNT_RETIRED' };
      }

      const lastActiveAt = activity.data()?.lastActiveAt;
    const lastActiveMs = typeof lastActiveAt?.toMillis === 'function'
      ? lastActiveAt.toMillis()
      : (lastActiveAt instanceof Date
        ? lastActiveAt.getTime()
        : (typeof lastActiveAt === 'number' ? lastActiveAt : Date.parse(String(lastActiveAt || ''))));
      const refreshDue = !Number.isFinite(lastActiveMs) || nowMs - lastActiveMs >= 60_000;

    // Throttle writes to at most once per minute, while still reading the
    // retirement marker in every transaction. This preserves the race fence:
    // an activity request and a retirement claim cannot both commit based on
    // stale reads of the other's marker/activity document.
      if (refreshDue) {
        transaction.set(activityRef, {
        uid,
        lastActiveAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      console.info('[ACTIVITY FENCE TRACE]', { stage: 'transaction_callback_completed', durationMs: Date.now() - startedAt, refreshDue });
      return { success: true };
    });
    console.info('[ACTIVITY FENCE TRACE]', { stage: 'transaction_committed', durationMs: Date.now() - startedAt, success: result.success });
    return result;
  } catch (error) {
    console.error('[ACTIVITY FENCE TRACE]', { stage: 'transaction_failed', durationMs: Date.now() - startedAt, code: String(error?.code || 'UNKNOWN'), message: String(error?.message || '').slice(0, 160) });
    throw error;
  }
}

module.exports = { recordUserActivityUnlessRetiring };
