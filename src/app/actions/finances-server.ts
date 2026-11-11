'use server';

/**
 * @fileOverview Серверный модуль финансов на базе Admin SDK.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { FinancialOpSchema } from '@/app/lib/validation-schemas';
import { logger } from '@/app/lib/logger';
import { requireServerActor } from '@/lib/server-auth';

/**
 * Выполняет финансовую операцию с проверкой ключа идемпотентности через Admin SDK.
 */
export async function processFinancialOperation(idToken: string, data: any) {
  const { uid: userId } = await requireServerActor(idToken);
  const validation = FinancialOpSchema.safeParse(data);
  if (!validation.success) return { success: false, error: "INVALID_INPUT" };

  const { idempotencyKey, amount, type, description } = validation.data;
  const db = getAdminDb();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const logRef = db.collection('system_v1').doc(`idempotency_${idempotencyKey}`);
      const logSnap = await transaction.get(logRef);

      if (logSnap.exists) {
        logger.warn("Idempotency match detected. Skipping operation.", { idempotencyKey });
        return { success: true, alreadyProcessed: true };
      }

      const playerRef = db.collection('players_v14').doc(userId);
      const playerSnap = await transaction.get(playerRef);
      if (!playerSnap.exists) throw new Error("PLAYER_NOT_FOUND");

      const pData = playerSnap.data()!;
      const currentBalance = Number(pData[type] || 0);

      if (amount < 0 && currentBalance < Math.abs(amount)) {
        throw new Error("INSUFFICIENT_FUNDS");
      }

      transaction.update(playerRef, { 
        [type]: currentBalance + amount,
        updatedAt: FieldValue.serverTimestamp() 
      });

      // TTL: 7 дней для очистки ключей
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      transaction.set(logRef, {
        userId,
        amount,
        type,
        description,
        processedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt)
      });

      return { success: true };
    });

    return result;
  } catch (error: any) {
    logger.error("Financial operation failed", error, { userId, idempotencyKey });
    return { success: false, error: error.message };
  }
}
