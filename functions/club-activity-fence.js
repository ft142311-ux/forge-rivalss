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

  return db.runTransaction(async (transaction) => {
    const [pending, retired, activity] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(retiredRef),
      transaction.get(activityRef),
    ]);

    if (pending.exists) return { success: false, error: 'ACCOUNT_RETIRING' };
    if (retired.exists) return { success: false, error: 'ACCOUNT_RETIRED' };

    const lastActiveAt = activity.data()?.lastActiveAt;
    const lastActiveMs = typeof lastActiveAt?.toMillis === 'function'
      ? lastActiveAt.toMillis()
      : (lastActiveAt instanceof Date ? lastActiveAt.getTime() : Date.parse(String(lastActiveAt || '')));
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

    return { success: true };
  });
}

module.exports = { recordUserActivityUnlessRetiring };
