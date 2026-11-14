import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { recordUserActivityUnlessRetiring } from '../../functions/club-activity-fence.js';

export interface ServerActor {
  uid: string;
  isAdmin: boolean;
}

/**
 * Verifies a Firebase ID token supplied by the browser.
 *
 * Important: we deliberately do not disable token validation when a token is
 * revoked. A revoked token must never be accepted by the server.
 *
 * Auth errors are normalized so Server Actions can return a normal business
 * error instead of turning the request into an opaque HTTP 500.
 */
export async function requireServerActor(idToken: string): Promise<ServerActor> {
  if (!idToken) throw new Error('AUTHENTICATION_REQUIRED');

  const db = getAdminDb();

  try {
    const decoded = await getAuth().verifyIdToken(idToken, true);
    const activity = await recordUserActivityUnlessRetiring(db, decoded.uid);
    if (!activity.success) throw new Error(activity.error);
    return { uid: decoded.uid, isAdmin: decoded.admin === true };
  } catch (error: any) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();

    // A disabled Auth user is terminal for this session, just like a revoked token.
    if (code.includes('user-disabled') || message.includes('user disabled')) {
      throw new Error('ACCOUNT_DISABLED');
    }

    // Keep revocation checks enabled. A revoked token is never accepted.
    // Expired tokens are recoverable by forcing a client-side ID-token refresh.
    if (
      code.includes('id-token-revoked') ||
      code.includes('token-revoked') ||
      message.includes('id token has been revoked') ||
      message.includes('token has been revoked')
    ) {
      throw new Error('AUTH_TOKEN_REVOKED');
    }

    if (
      code.includes('id-token-expired') ||
      code.includes('invalid-id-token') ||
      code.includes('argument-error') ||
      message.includes('invalid id token') ||
      message.includes('expired')
    ) {
      throw new Error('AUTH_TOKEN_INVALID');
    }

    throw error;
  }
}

export async function requireAdminActor(idToken: string): Promise<ServerActor> {
  const actor = await requireServerActor(idToken);
  if (!actor.isAdmin) throw new Error('ADMIN_REQUIRED');
  return actor;
}
