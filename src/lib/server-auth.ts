import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase-admin';

const { recordUserActivityUnlessRetiring } = require('../../functions/club-activity-fence.js') as {
  recordUserActivityUnlessRetiring: (
    db: ReturnType<typeof getAdminDb>,
    uid: string,
  ) => Promise<{ success: boolean; error?: string }>;
};

export interface ServerActor {
  uid: string;
  isAdmin: boolean;
  email: string | null;
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
  const authStartedAt = Date.now();

  try {
    console.info('[SERVER AUTH TRACE]', { stage: 'token_verification_started' });
    const decoded = await getAuth().verifyIdToken(idToken, true);
    console.info('[SERVER AUTH TRACE]', { stage: 'token_verified', durationMs: Date.now() - authStartedAt });
    const activityStartedAt = Date.now();
    console.info('[SERVER AUTH TRACE]', { stage: 'activity_fence_started' });
    const activity = await recordUserActivityUnlessRetiring(db, decoded.uid);
    console.info('[SERVER AUTH TRACE]', { stage: 'activity_fence_finished', durationMs: Date.now() - activityStartedAt, success: activity.success, error: activity.error || null });
    if (!activity.success) throw new Error(activity.error);
    return {
      uid: decoded.uid,
      isAdmin: decoded.admin === true,
      email: typeof decoded.email === 'string' ? decoded.email : null,
    };
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

    console.error('[SERVER AUTH TRACE]', { stage: 'actor_verification_failed', durationMs: Date.now() - authStartedAt, code: code || 'UNKNOWN', message: message.slice(0, 120) });
    throw error;
  }
}

export async function requireAdminActor(idToken: string): Promise<ServerActor> {
  const actor = await requireServerActor(idToken);
  if (!actor.isAdmin) throw new Error('ADMIN_REQUIRED');
  return actor;
}
