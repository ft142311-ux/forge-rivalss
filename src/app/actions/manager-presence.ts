'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

/**
 * Writes a server-timestamped presence heartbeat for the authenticated manager.
 * UID and timestamp are server-derived; clients cannot choose either value.
 */
export async function recordManagerPresenceAction(idToken: string) {
  try {
    const actor = await requireServerActor(idToken);
    const db = getAdminDb();
    await db.collection('manager_presence_v1').doc(actor.uid).set({
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
