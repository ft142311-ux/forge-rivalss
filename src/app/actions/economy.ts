
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getMoscowDateString } from '@/app/lib/time-utils';
import { getDailyRewardForDay, getNextDailyRewardDay, getPremiumDailyCrystalBonus } from '@/app/lib/daily-reward';
import { requireServerActor } from '@/lib/server-auth';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';
import { tryCreateManagerXpAward, MANAGER_XP_REWARDS } from '@/app/lib/manager-progression';

/**
 * @fileOverview Защищенный слой экономики.
 * Все изменения баланса проходят через этот модуль.
 */

function readCurrencyBalance(value: unknown) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('INVALID_BALANCE');
  if (typeof value === 'string' && value.trim().length === 0) throw new Error('INVALID_BALANCE');
  const balance = Number(value);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('INVALID_BALANCE');
  return balance;
}

/**
 * Публичный экшн для получения ежедневной награды.
 */
export async function claimDailyRewardAction(idToken: string) {
  try {
    const { uid: userId } = await requireServerActor(idToken);
    const db = getAdminDb();
  const today = getMoscowDateString();
  const playerRef = db.collection('players_v14').doc(userId);
  const receiptRef = db.collection('daily_reward_receipts').doc(`${userId}_${today}`);

  try {
    const result = await db.runTransaction(async (t) => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const receiptSnap = await t.get(receiptRef);
      if (receiptSnap.exists) return receiptSnap.data()?.result;

      const pSnap = await t.get(playerRef);
      if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");

      const p = pSnap.data()!;
      if (p.lastRewardClaimDate === today) return { success: true, alreadyClaimed: true, rewardDay: Number(p.rewardDay || 1), claimedDate: today, credits: 0, crystals: 0, premiumBonus: 0 };

      const rewardDay = getNextDailyRewardDay(p.rewardDay, Boolean(p.lastRewardClaimDate));
      const { credits, crystals: baseCrystals } = getDailyRewardForDay(rewardDay);
      const premiumUntilMs = p.premiumUntil ? new Date(String(p.premiumUntil)).getTime() : 0;
      const premiumBonus = getPremiumDailyCrystalBonus(p.isPremium === true && premiumUntilMs > Date.now());
      const crystals = baseCrystals + premiumBonus;
      const creditsBefore = readCurrencyBalance(p.credits);
      const crystalsBefore = readCurrencyBalance(p.crystals);
      const creditsAfter = creditsBefore + credits;
      const crystalsAfter = crystalsBefore + crystals;
      const managerXpAttempt = tryCreateManagerXpAward(p, MANAGER_XP_REWARDS.dailyReward, 'daily_reward');
      const managerXpAward = managerXpAttempt.award;
      const managerXpSkippedReason = managerXpAttempt.skippedReason;
      const managerXpResult = managerXpAward ? {
        amount: managerXpAward.receipt.amount,
        levelsGained: managerXpAward.receipt.levelsGained,
        managerLevel: managerXpAward.profilePatch.managerLevel,
        experiencePoints: managerXpAward.profilePatch.experiencePoints,
      } : null;
      if (!Number.isSafeInteger(creditsAfter) || !Number.isSafeInteger(crystalsAfter)) {
        throw new Error('INVALID_BALANCE');
      }
      const result = { success: true, alreadyClaimed: false, rewardDay, claimedDate: today, credits, crystals, premiumBonus, managerXp: managerXpResult, managerXpSkippedReason };

      t.update(playerRef, {
        credits: creditsAfter,
        crystals: crystalsAfter,
        lastRewardClaimDate: today,
        rewardDay,
        ...(managerXpAward ? managerXpAward.profilePatch : {}),
        updatedAt: FieldValue.serverTimestamp()
      });

      t.create(db.collection('economy_transactions').doc(`daily_reward_${userId}_${today}_credits`), {
        userId,
        amount: credits,
        currency: 'credits',
        type: 'DAILY_REWARD',
        referenceId: today,
        description: `Daily reward day ${rewardDay}`,
        balanceBefore: creditsBefore,
        balanceAfter: creditsAfter,
        timestamp: FieldValue.serverTimestamp()
      });
      t.create(db.collection('economy_transactions').doc(`daily_reward_${userId}_${today}_crystals`), {
        userId,
        amount: crystals,
        currency: 'crystals',
        type: 'DAILY_REWARD',
        referenceId: today,
        description: `Daily reward day ${rewardDay}`,
        balanceBefore: crystalsBefore,
        balanceAfter: crystalsAfter,
        timestamp: FieldValue.serverTimestamp()
      });
      t.create(receiptRef, {
        userId,
        date: today,
        rewardDay,
        managerXp: managerXpAward?.receipt ?? null,
        managerXpSkippedReason,
        result,
        createdAt: FieldValue.serverTimestamp()
      });

      return result;
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
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const playerRef = db.collection('players_v14').doc(uid);
      const playerSnap = await t.get(playerRef);
      if (!playerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const player = playerSnap.data() || {};
      const now = Date.now();
      const currentUntil = player.premiumUntil ? new Date(String(player.premiumUntil)).getTime() : 0;
      if (player.isPremium === true && currentUntil > now) throw new Error('PREMIUM_ALREADY_ACTIVE');

      const cost = 5000;
      const crystals = readCurrencyBalance(player.crystals);
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
