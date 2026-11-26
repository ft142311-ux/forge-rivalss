'use client';

import { signOut } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';

type TokenAction<T> = (idToken: string) => Promise<T>;

function getErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase();
  if (typeof error === 'string') return error.toLowerCase();
  try { return JSON.stringify(error).toLowerCase(); } catch { return ''; }
}

function isTokenError(error: unknown): boolean {
  const text = getErrorText(error);
  return text.includes('auth_token_revoked') || text.includes('auth_token_invalid') ||
    text.includes('id-token-revoked') || text.includes('id-token-expired') ||
    text.includes('invalid-id-token') || text.includes('token has been revoked');
}

function isTerminalRefreshError(error: unknown): boolean {
  const text = getErrorText(error);
  return [
    'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled',
    'auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-refresh-token',
    'auth/token-expired', 'auth/requires-recent-login'
  ].some((code) => text.includes(code));
}

/**
 * Runs one Firebase-authenticated Server Action. If the server explicitly
 * rejects the ID token, force-refreshes it and retries exactly once. It never
 * bypasses server-side token verification.
 */
export async function runWithFreshIdToken<T>(
  auth: Auth | null,
  user: User | null,
  action: TokenAction<T>
): Promise<T> {
  if (!auth || !user) throw new Error('AUTHENTICATION_REQUIRED');

  let firstToken: string;
  try {
    firstToken = await user.getIdToken(true);
  } catch (refreshError) {
    if (isTerminalRefreshError(refreshError)) {
      try { await signOut(auth); } catch { /* Auth state listener handles navigation. */ }
      throw new Error('AUTH_SESSION_EXPIRED');
    }
    throw refreshError;
  }

  try {
    return await action(firstToken);
  } catch (firstError) {
    if (!isTokenError(firstError)) throw firstError;

    let refreshedToken: string;
    try {
      refreshedToken = await user.getIdToken(true);
    } catch (refreshError) {
      if (isTerminalRefreshError(refreshError)) {
        try { await signOut(auth); } catch { /* Auth state listener handles navigation. */ }
        throw new Error('AUTH_SESSION_EXPIRED');
      }
      throw refreshError;
    }

    if (auth.currentUser?.uid !== user.uid) throw new Error('AUTHENTICATION_REQUIRED');
    if (refreshedToken === firstToken) {
      // A second server rejection of the same token cannot be repaired by retrying.
      try { await signOut(auth); } catch { /* Auth state listener handles navigation. */ }
      throw new Error('AUTH_SESSION_EXPIRED');
    }

    try {
      return await action(refreshedToken);
    } catch (retryError) {
      if (isTokenError(retryError)) {
        try { await signOut(auth); } catch { /* Auth state listener handles navigation. */ }
        throw new Error('AUTH_SESSION_EXPIRED');
      }
      throw retryError;
    }
  }
}
