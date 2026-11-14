
'use server';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getMoscowDateString } from '@/app/lib/time-utils';
import { getDailyRewardForDay, getNextDailyRewardDay, getPremiumDailyCrystalBonus } from '@/app/lib/daily-reward';
import { requireServerActor } from '@/lib/server-auth';

/**
 * @fileOverview Защищенный слой экономики.
 * Все изменения баланса проходят через этот модуль.
 */

/**
 * Публичный экшн для получения ежедневной награды.
 */
export async function claimDailyRewardAction(idToken: string) {
  try {
    const { uid: userId } = await requireServerActor(idToken);
    const db = getAdminDb();
  const today = getMoscowDateString();
  const playerRef = db.collection('players_v14').doc(userId);

  try {
    const result = await db.runTransaction(async (t) => {
      const pSnap = await t.get(playerRef);
      if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");
      
      const p = pSnap.data()!;
      if (p.lastRewardClaimDate === today) throw new Error("ALREADY_CLAIMED");

      const rewardDay = getNextDailyRewardDay(p.rewardDay, Boolean(p.lastRewardClaimDate));
      const { credits, crystals: baseCrystals } = getDailyRewardForDay(rewardDay);
      const premiumUntilMs = p.premiumUntil ? new Date(String(p.premiumUntil)).getTime() : 0;
      const premiumBonus = getPremiumDailyCrystalBonus(p.isPremium === true && premiumUntilMs > Date.now());
      const crystals = baseCrystals + premiumBonus;

      // Применяем награду
      t.update(playerRef, {
        credits: (p.credits || 0) + credits,
        crystals: (p.crystals || 0) + crystals,
        lastRewardClaimDate: today,
        rewardDay: rewardDay,
        updatedAt: FieldValue.serverTimestamp()
      });

      return { success: true, credits, crystals, premiumBonus };
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
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const playerRef = db.collection('players_v14').doc(uid);
      const playerSnap = await t.get(playerRef);
      if (!playerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const player = playerSnap.data() || {};
      const now = Date.now();
      const currentUntil = player.premiumUntil ? new Date(String(player.premiumUntil)).getTime() : 0;
      if (player.isPremium === true && currentUntil > now) throw new Error('PREMIUM_ALREADY_ACTIVE');

      const cost = 5000;
      const crystals = Number(player.crystals || 0);
      if (crystals < cost) throw new Error('INSUFFICIENT_FUNDS');
      const premiumUntil = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

      t.update(playerRef, {
        crystals: crystals - cost,
        isPremium: true,
        premiumUntil,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const ledgerRef = db.collection('economy_transactions').doc();
      t.set(ledgerRef, {
        userId: uid,
        amount: -cost,
        currency: 'crystals',
        type: 'PREMIUM_PURCHASE',
        referenceId: 'premium_30d',
        description: '30 Days Elite Status',
        balanceBefore: crystals,
        balanceAfter: crystals - cost,
        timestamp: FieldValue.serverTimestamp(),
      });
      return { success: true, premiumUntil, crystals: crystals - cost };
    });
  } catch (e: any) {
    return { success: false, error: e?.message || 'PREMIUM_PURCHASE_FAILED' };
  }
}
