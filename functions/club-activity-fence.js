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
async function recordUserActivityUnlessRetiring(db, uid) {
  if (!db || !uid) return { success: false, error: 'INVALID_ACTIVITY_CONTEXT' };

  const pendingRef = db.collection('inactive_club_retirements_v1').doc(uid);
  const activityRef = db.collection('user_activity_v1').doc(uid);

  return db.runTransaction(async (transaction) => {
    const pending = await transaction.get(pendingRef);
    if (pending.exists) {
      return { success: false, error: 'ACCOUNT_RETIRING' };
    }

    transaction.set(activityRef, {
      uid,
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true };
  });
}

module.exports = { recordUserActivityUnlessRetiring };
