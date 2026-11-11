'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

/** Accepts a pending request as its recipient and creates the notification atomically. */
export async function acceptFriendRequestAction(idToken: string, requestId: string, language: 'ru' | 'en') {
  try {
    const { uid } = await requireServerActor(idToken);
    if (!requestId || requestId.length > 180) throw new Error('INVALID_REQUEST_ID');
    const db = getAdminDb();
    const requestRef = db.collection('friend_requests_v4').doc(requestId);
    const notificationRef = db.collection('notifications_v7').doc();

    await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) throw new Error('FRIEND_REQUEST_NOT_FOUND');
      const request: any = requestSnap.data() || {};
      if (request.toId !== uid) throw new Error('FORBIDDEN');
      if (request.status !== 'pending') throw new Error('FRIEND_REQUEST_NOT_PENDING');

      const fromId = String(request.fromId || '');
      if (!fromId || fromId === uid) throw new Error('INVALID_FRIEND_REQUEST');
      const recipientName = String(request.toName || 'Manager').slice(0, 80);
      const title = language === 'ru' ? 'Запрос принят!' : 'Request Accepted!';
      const description = language === 'ru'
        ? `Менеджер ${recipientName} теперь ваш друг.`
        : `Manager ${recipientName} is now your friend.`;

      tx.update(requestRef, {
        status: 'accepted',
        updatedAt: new Date().toISOString(),
      });
      tx.set(notificationRef, {
        userId: fromId,
        title,
        description,
        type: 'social',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'FRIEND_REQUEST_ACCEPT_FAILED' };
  }
}
