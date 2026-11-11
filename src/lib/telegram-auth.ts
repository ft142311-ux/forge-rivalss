'use client';

import {
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';

function getDeterministicPassword(tgUserId: string | number) {
  const salt = process.env.NEXT_PUBLIC_TELEGRAM_SALT || 'lote_fallback_salt_2026';
  const input = `tg_${tgUserId}_${salt}`;

  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return `pass_${Math.abs(hash).toString(16)}_${tgUserId}`;
}

function getTelegramUserFromWindow(): any | null {
  if (typeof window === 'undefined') return null;
  return (window as any).Telegram?.WebApp?.initDataUnsafe?.user || null;
}

async function waitForTelegramUser(timeoutMs = 3000): Promise<any | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tgUser = getTelegramUserFromWindow();
    if (tgUser?.id) return tgUser;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return getTelegramUserFromWindow();
}

/**
 * Re-establishes the same Firebase account after the server rejects the
 * current ID token as revoked/expired.
 *
 * We intentionally sign in again instead of weakening server-side token
 * verification.
 */
export async function restoreTelegramSession(auth: Auth): Promise<User> {
  const tgUser = await waitForTelegramUser();

  let telegramId = tgUser?.id ? String(tgUser.id) : '';
  const currentEmail = auth.currentUser?.email || '';

  if (!telegramId && currentEmail.startsWith('tg_') && currentEmail.endsWith('@telegram.lote')) {
    telegramId = currentEmail.slice(3, -'@telegram.lote'.length);
  }

  if (!telegramId) {
    throw new Error('TELEGRAM_SESSION_RESTORE_UNAVAILABLE');
  }

  const email = `tg_${telegramId}@telegram.lote`;
  const password = getDeterministicPassword(telegramId);

  try {
    // Drop the revoked browser session first.
    await signOut(auth);
  } catch {
    // Firebase may already have cleared the local session.
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error: any) {
    if (error?.code !== 'auth/user-not-found' && error?.code !== 'auth/invalid-credential') {
      throw error;
    }

    const created = await createUserWithEmailAndPassword(auth, email, password);
    return created.user;
  }

  const restoredUser = auth.currentUser;
  if (!restoredUser) throw new Error('TELEGRAM_SESSION_RESTORE_FAILED');

  await restoredUser.getIdToken(true);
  return restoredUser;
}

export async function syncTelegramUser(auth: Auth, tgUser: any) {
  const email = `tg_${tgUser.id}@telegram.lote`;
  const password = getDeterministicPassword(tgUser.id);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    return { status: 'logged_in' as const };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        return { status: 'registered' as const, userId: userCredential.user.uid };
      } catch (regError) {
        console.error('TG Deterministic Registration failed', regError);
        throw regError;
      }
    }
    throw error;
  }
}
