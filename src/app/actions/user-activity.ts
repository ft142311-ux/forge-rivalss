'use server';

import { requireServerActor } from '@/lib/server-auth';

/**
 * Records a server-verified app session. The client cannot choose the timestamp
 * or UID; only a currently valid, non-disabled Firebase identity is accepted.
 */
export async function recordUserActivityAction(idToken: string) {
  try {
    await requireServerActor(idToken);
    // requireServerActor verifies token revocation and performs the transactional
    // activity/retirement fence for every authenticated server action.
    return { success: true };
  } catch (error: any) {
    const code = String(error?.message || error?.code || 'ACTIVITY_RECORD_FAILED');
    return { success: false, error: code.slice(0, 100) };
  }
}
