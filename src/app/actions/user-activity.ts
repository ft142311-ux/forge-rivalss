'use server';

import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { recordUserActivityUnlessRetiring } from '../../../functions/club-activity-fence.js';

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
    const result = await recordUserActivityUnlessRetiring(db, actor.uid);
    if (!result.success) return result;

    return { success: true };
  } catch (error: any) {
    const code = String(error?.message || error?.code || 'ACTIVITY_RECORD_FAILED');
    return { success: false, error: code.slice(0, 100) };
  }
}
