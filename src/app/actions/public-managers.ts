'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { isManagerOnline } from '../../../../functions/manager-presence-policy';

const PAGE_SIZE = 100;

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

/**
 * Returns only fields intended for the public manager directory.
 * Private profile data (email, balances, roster, premium expiry, etc.) never
 * leaves the server through this action.
 */
export async function listPublicManagersAction(idToken: string, cursor?: string | null) {
  try {
    await requireServerActor(idToken);
    if (cursor !== undefined && cursor !== null &&
      (typeof cursor !== 'string' || !cursor.trim() || cursor.length > 150)) {
      throw new Error('INVALID_MANAGER_CURSOR');
    }

    const db = getAdminDb();
    let request = db.collection('players_v14').orderBy('__name__').limit(PAGE_SIZE + 1);
    if (cursor) {
      const cursorSnapshot = await db.collection('players_v14').doc(cursor).get();
      if (!cursorSnapshot.exists) throw new Error('INVALID_MANAGER_CURSOR');
      request = request.startAfter(cursorSnapshot);
    }

    const snapshot = await request.get();
    const hasMore = snapshot.docs.length > PAGE_SIZE;
    const page = snapshot.docs.slice(0, PAGE_SIZE);
    const presenceSnapshots = page.length
      ? await db.getAll(...page.map((document) => db.collection('manager_presence_v1').doc(document.id)))
      : [];
    const presenceByManagerId = new Map(
      presenceSnapshots.map((presence) => [
        presence.id,
        isManagerOnline(presence.exists ? presence.data()?.lastSeen : null),
      ])
    );
    const managers = page.flatMap((document) => {
      const data = document.data();
      const displayName = typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '';
      if (displayName.length < 2 || displayName === 'Unknown Commander') return [];
      const premiumUntil = toIso(data.premiumUntil);
      return [{
        id: document.id,
        displayName,
        managerLevel: Number.isFinite(Number(data.managerLevel)) ? Math.max(1, Number(data.managerLevel)) : 1,
        associationId: typeof data.associationId === 'string' ? data.associationId.slice(0, 128) : null,
        createdAt: toIso(data.createdAt),
        isPremium: Boolean(premiumUntil && new Date(premiumUntil).getTime() > Date.now()),
        isOnline: presenceByManagerId.get(document.id) === true,
      }];
    });

    return {
      success: true as const,
      managers,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  } catch (error: any) {
    return { success: false as const, error: error?.message || 'MANAGER_DIRECTORY_UNAVAILABLE' };
  }
}
