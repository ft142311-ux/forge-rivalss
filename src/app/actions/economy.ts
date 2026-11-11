
'use server';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { z } from 'zod';
import { getMoscowTime } from '@/app/lib/time-utils';
import { requireServerActor } from '@/lib/server-auth';

/**
 * @fileOverview Защищенный слой экономики.
 * Все изменения баланса проходят через этот модуль.
 */

const TransactionSchema = z.object({
  userId: z.string(),
  amount: z.number(),
  currency: z.enum(['credits', 'crystals']),
  type: z.string(),
  referenceId: z.string().optional(),
  description: z.string().optional()
});

/**
 * Внутренняя функция для применения транзакции.
 * НЕ ЭКСПОРТИРУЕТСЯ наружу для прямого вызова клиентом.
 */
async function applyTransaction(params: z.infer<typeof TransactionSchema>) {
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(params.userId);

  return await db.runTransaction(async (t) => {
    const pSnap = await t.get(playerRef);
    if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");

    const pData = pSnap.data()!;
    const currentBalance = Number(pData[params.currency] || 0);
    const newBalance = currentBalance + params.amount;

    if (newBalance < 0) throw new Error("INSUFFICIENT_FUNDS");

    // 1. Обновляем баланс
    t.update(playerRef, {
      [params.currency]: newBalance,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 2. Логируем в реестр (Audit Log)
    const logRef = db.collection('economy_transactions').doc();
    t.set(logRef, {
      ...params,
      balanceBefore: currentBalance,
      balanceAfter: newBalance,
      timestamp: FieldValue.serverTimestamp()
    });

    return { success: true, newBalance };
  });
}

/**
 * Публичный экшн для получения ежедневной награды.
 */
export async function claimDailyRewardAction(idToken: string) {
  try {
    const { uid: userId } = await requireServerActor(idToken);
    const db = getAdminDb();
  const today = new Date().toISOString().split('T')[0]; // МСК Дата в идеале
  const playerRef = db.collection('players_v14').doc(userId);

  try {
    const result = await db.runTransaction(async (t) => {
      const pSnap = await t.get(playerRef);
      if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");
      
      const p = pSnap.data()!;
      if (p.lastRewardClaimDate === today) throw new Error("ALREADY_CLAIMED");

      const rewardDay = (p.rewardDay || 0) % 30 + 1;
      const credits = 100000 + (rewardDay * 50000);
      const crystals = 10 + (rewardDay % 7 === 0 ? 50 : 0);

      // Применяем награду
      t.update(playerRef, {
        credits: (p.credits || 0) + credits,
        crystals: (p.crystals || 0) + crystals,
        lastRewardClaimDate: today,
        rewardDay: rewardDay,
        updatedAt: FieldValue.serverTimestamp()
      });

      return { success: true, credits, crystals };
    });

    return result;
  } catch (e: any) {
    return { success: false, error: e?.message || 'DAILY_REWARD_FAILED' };
  }
  } catch (e: any) {
    return { success: false, error: e?.message || 'AUTHENTICATION_FAILED' };
  }
}

/**
 * Экшн для покупки элитного статуса.
 */
export async function purchasePremiumAction(idToken: string) {
  try {
    const { uid: userId } = await requireServerActor(idToken);
    return await applyTransaction({
      userId,
      amount: -5000,
      currency: 'crystals',
      type: 'PREMIUM_PURCHASE',
      description: '30 Days Elite Status'
    });
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
