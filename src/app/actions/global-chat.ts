'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

/**
 * Creates a global-chat message using only server-verified identity and profile
 * fields. The client supplies text only; it cannot impersonate another club.
 */
export async function sendGlobalChatMessageAction(idToken: string, rawText: string) {
  try {
    const actor = await requireServerActor(idToken);
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text || text.length > 1000) throw new Error('INVALID_CHAT_MESSAGE');

    const db = getAdminDb();
    const profileSnap = await db.collection('players_v14').doc(actor.uid).get();
    if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    const profile = profileSnap.data() || {};

    const displayName = typeof profile.displayName === 'string'
      ? profile.displayName.trim().slice(0, 80) || 'Manager'
      : 'Manager';
    const clubName = typeof profile.clubName === 'string'
      ? profile.clubName.trim().slice(0, 80) || displayName
      : displayName;
    const clubLogo = typeof profile.clubLogo === 'string'
      ? profile.clubLogo.slice(0, 2048)
      : '';
    const isPremium = profile.isPremium === true;
    const createdAt = new Date().toISOString();

    const messageRef = db.collection('global_chat_v2').doc();
    await messageRef.create({
      userId: actor.uid,
      userName: displayName,
      clubName,
      clubLogo,
      isPremium,
      text,
      createdAt,
    });

    return { success: true as const, messageId: messageRef.id };
  } catch (error: any) {
    return {
      success: false as const,
      error: String(error?.message || 'GLOBAL_CHAT_SEND_FAILED').slice(0, 100),
    };
  }
}
