import type { User } from 'firebase/auth';

/** True only for auth failures where the server rejects the supplied token before running the action. */
export function isRecoverableAuthTokenError(value: unknown): boolean {
  const candidate: any = value as any;
  const message = String(candidate?.message || candidate?.error || candidate || '').toLowerCase();
  const code = String(candidate?.code || '').toLowerCase();
  return (
    message.includes('auth_token_revoked') ||
    message.includes('auth-token-revoked') ||
    message.includes('id token has been revoked') ||
    message.includes('token has been revoked') ||
    message.includes('auth/id-token-revoked') ||
    message.includes('auth/id-token-expired') ||
    code.includes('id-token-revoked') ||
    code.includes('id-token-expired')
  );
}

/**
 * Refreshes the Firebase ID token and retries once only when the server explicitly
 * rejects authentication. It never retries ordinary business errors or network failures.
 */
export async function callWithFreshAuthToken<T>(
  user: User,
  action: (idToken: string) => Promise<T>,
  isRejectedResult?: (result: T) => boolean,
): Promise<T> {
  const run = async (forceRefresh: boolean) => action(await user.getIdToken(forceRefresh));

  let result: T;
  let retried = false;
  try {
    result = await run(true);
  } catch (error) {
    if (!isRecoverableAuthTokenError(error)) throw error;
    retried = true;
    result = await run(true);
  }

  if (isRejectedResult?.(result)) {
    if (retried) throw new Error('AUTH_SESSION_REAUTH_REQUIRED');
    const refreshedResult = await run(true);
    if (isRejectedResult(refreshedResult)) {
      throw new Error('AUTH_SESSION_REAUTH_REQUIRED');
    }
    return refreshedResult;
  }

  return result;
}
