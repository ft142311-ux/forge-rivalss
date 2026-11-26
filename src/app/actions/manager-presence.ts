'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { isManagerOnline } from '../../../functions/manager-presence-policy';

/**
 * Writes a server-timestamped presence heartbeat for the authenticated manager.
 * UID and timestamp are server-derived; clients cannot choose either value.
 */
export async function recordManagerPresenceAction(idToken: string) {
  try {
    if (!idToken) throw new Error('AUTHENTICATION_REQUIRED');
    // Presence is auxiliary telemetry, not a protected game mutation. Verify
    // the Firebase session (including revocation) but do not invoke the
    // Firestore-backed retirement/activity fence: registration already runs
    // that fence and must not be blocked by a concurrent heartbeat.
    const decoded = await getAuth().verifyIdToken(idToken, true);
    const db = getAdminDb();
    await db.collection('manager_presence_v1').doc(decoded.uid).set({
      lastSeen: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true as const };
  } catch (error: any) {
    return {
      success: false as const,
      error: String(error?.message || 'PRESENCE_HEARTBEAT_FAILED').slice(0, 100),
    };
  }
}

/**
 * Returns only derived online booleans for IDs already shown in the public
 * manager directory. Raw presence timestamps never leave the server.
 */
export async function getPublicManagerPresenceAction(idToken: string, managerIds: string[]) {
  try {
    if (!idToken) throw new Error('AUTHENTICATION_REQUIRED');
    await getAuth().verifyIdToken(idToken, true);
    if (!Array.isArray(managerIds) || managerIds.length > 100) {
      throw new Error('INVALID_MANAGER_PRESENCE_REQUEST');
    }
    const ids = [...new Set(managerIds)];
    if (ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 150)) {
      throw new Error('INVALID_MANAGER_PRESENCE_REQUEST');
    }

    const db = getAdminDb();
    const snapshots = ids.length
      ? await db.getAll(...ids.map((id) => db.collection('manager_presence_v1').doc(id)))
      : [];
    return {
      success: true as const,
      presence: snapshots.map((snapshot) => ({
        id: snapshot.id,
        isOnline: isManagerOnline(snapshot.exists ? snapshot.data()?.lastSeen : null),
      })),
    };
  } catch (error: any) {
    return {
      success: false as const,
      error: String(error?.message || 'MANAGER_PRESENCE_UNAVAILABLE').slice(0, 100),
    };
  }
}
