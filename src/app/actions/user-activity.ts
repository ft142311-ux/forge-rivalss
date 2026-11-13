'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

/**
 * Records a server-verified app session. The client cannot choose the timestamp
 * or UID; only a currently valid, non-disabled Firebase identity is accepted.
 */
export async function recordUserActivityAction(idToken: string) {
  try {
    const actor = await requireServerActor(idToken);
    const authUser = await getAuth().getUser(actor.uid);
    if (authUser.disabled) return { success: false, error: 'ACCOUNT_DISABLED' };

    const db = getAdminDb();
    await db.collection('user_activity_v1').doc(actor.uid).set({
      uid: actor.uid,
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true };
  } catch (error: any) {
    const code = String(error?.message || error?.code || 'ACTIVITY_RECORD_FAILED');
    return { success: false, error: code.slice(0, 100) };
  }
}
