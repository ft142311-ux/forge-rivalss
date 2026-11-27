'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { generateVtunePlayer } from '@/app/lib/moba-data';
import { getMoscowDateString, getMoscowTime } from '@/app/lib/time-utils';
import { canPruneUnbidSystemAuctionLot } from '@/app/lib/auction-settlement';
import { placeSpecialMarketBidWithDb } from '@/app/lib/auction-bid';
import { createYouthMarketListingWithDb } from '@/app/lib/market-listing';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'PRO_MARKET_FAILED');
}

function money(value: unknown) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

/**
 * Creates the daily system PRO lot and removes stale system drops.
 * All market mutations use Admin SDK; client Firestore rules remain read-only.
 */
export async function ensureProMarketDailyDropAction(idToken: string) {
  try {
    await requireServerActor(idToken);
    const db = getAdminDb();
    const today = getMoscowDateString();
    const moscowNow = getMoscowTime();
    const lotId = `sys_vtune_v900_final_standard_${today}`;
    const lotRef = db.collection('market_v7').doc(lotId);
    const systemLotsQuery = db.collection('market_v7').where('isSystem', '==', true);
    const resetConfigRef = db.collection('system_v1').doc('season_config');

    const expiry = new Date(moscowNow);
    expiry.setDate(expiry.getDate() + 2);
    expiry.setHours(23, 59, 59, 999);
    const generatedPlayer = generateVtunePlayer(today);

    const result = await db.runTransaction(async (tx) => {
      const [systemLots, currentLot, resetConfig] = await Promise.all([
        tx.get(systemLotsQuery),
        tx.get(lotRef),
        tx.get(resetConfigRef),
      ]);
      if (resetConfig.exists && (resetConfig.data()?.stagingSeasonOneResetInProgress === true ||
          resetConfig.data()?.stagingFreshSeasonOneReset === true)) {
        throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
      }

      let removed = 0;
      let retainedWithBids = 0;
      for (const oldLot of systemLots.docs) {
        if (oldLot.id === lotId) continue;
        if (canPruneUnbidSystemAuctionLot(oldLot.data() || {})) {
          tx.delete(oldLot.ref);
          removed++;
        } else {
          // A bid/escrow is still outstanding; the shared expiry sweep owns settlement.
          retainedWithBids++;
        }
      }

      if (!currentLot.exists) {
        tx.set(lotRef, {
          id: lotId,
          heroData: JSON.parse(JSON.stringify(generatedPlayer)),
          currentBid: 2000,
          startingPrice: 2000,
          highestBidderId: null,
          highestBidderName: null,
          bidders: [],
          expiresAt: expiry.toISOString(),
          dropDate: today,
          createdAt: FieldValue.serverTimestamp(),
          isSystem: true,
          isPro: true,
          currency: 'crystals',
          sellerId: 'system',
          sellerName: 'System',
        });
      }

      return { created: !currentLot.exists, removed, retainedWithBids };
    });

    return { success: true, lotId, ...result };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Places a bid on a special auction with server-side type, balance and expiry checks. */
async function placeSpecialMarketBid(
  idToken: string,
  marketId: string,
  amount: number,
  marketKind: 'pro' | 'youth',
) {
  const { uid } = await requireServerActor(idToken);
  return placeSpecialMarketBidWithDb(getAdminDb(), uid, marketId, amount, marketKind);
}

export async function placeProMarketBidAction(idToken: string, marketId: string, amount: number) {
  try {
    return await placeSpecialMarketBid(idToken, marketId, amount, 'pro');
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function placeYouthMarketBidAction(idToken: string, marketId: string, amount: number) {
  try {
    return await placeSpecialMarketBid(idToken, marketId, amount, 'youth');
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Lists an owned youth player atomically and marks the authoritative profile entry as reserved. */
export async function listYouthPlayerOnMarketAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    return await createYouthMarketListingWithDb(getAdminDb(), uid, playerId);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
