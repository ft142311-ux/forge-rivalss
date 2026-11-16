'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { generateVtunePlayer } from '@/app/lib/moba-data';
import { getMoscowDateString, getMoscowTime } from '@/app/lib/time-utils';
import { canPruneUnbidSystemAuctionLot } from '@/app/lib/auction-settlement';
import { placeSpecialMarketBidWithDb } from '@/app/lib/auction-bid';

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

    const expiry = new Date(moscowNow);
    expiry.setDate(expiry.getDate() + 2);
    expiry.setHours(23, 59, 59, 999);
    const generatedPlayer = generateVtunePlayer(today);

    const result = await db.runTransaction(async (tx) => {
      const [systemLots, currentLot] = await Promise.all([
        tx.get(systemLotsQuery),
        tx.get(lotRef),
      ]);

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

/** Places a bid on a special auction with server-side type, balance and expasync function placeSpecialMarketBid(
  idToken: string,
  marketId: string,
  amount: number,
  marketKind: 'pro' | 'youth',
) {
  const { uid } = await requireServerActor(idToken);
  return placeSpecialMarketBidWithDb(getAdminDb(), uid, marketId, amount, marketKind);
}
    };
  });
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
    if (!playerId || playerId.length > 128) throw new Error('INVALID_PLAYER_ID');
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    const now = Date.now();
    const expiresAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const marketId = `youth_${uid}_${now}`;
    const marketRef = db.collection('market_v7').doc(marketId);

    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const profile: any = profileSnap.data() || {};
      const youthPlayers: any[] = Array.isArray(profile.youthAcademyPlayers) ? [...profile.youthAcademyPlayers] : [];
      const playerIndex = youthPlayers.findIndex((player) => String(player?.id) === playerId);
      if (playerIndex < 0) throw new Error('YOUTH_PLAYER_NOT_OWNED');

      const player = youthPlayers[playerIndex];
      if (player.onTransferUntil) throw new Error('PLAYER_ALREADY_ON_MARKET');
      const startPrice = Math.max(1, Math.floor(Number(player.overallRating || 0) * 5000 + 25000));
      const listedPlayer = { ...player, onTransferUntil: expiresAt, transferMarketId: marketId };
      youthPlayers[playerIndex] = listedPlayer;

      tx.create(marketRef, {
        id: marketId,
        heroData: JSON.parse(JSON.stringify(listedPlayer)),
        currentBid: startPrice,
        startingPrice: startPrice,
        highestBidderId: null,
        highestBidderName: null,
        bidders: [],
        sellerId: uid,
        sellerName: String(profile.displayName || profile.clubName || 'Manager'),
        expiresAt,
        dropDate: new Date(now).toISOString().slice(0, 10),
        dropTime: new Date(now).toISOString(),
        isYouth: true,
        currency: 'credits',
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(profileRef, { youthAcademyPlayers: youthPlayers, updatedAt: FieldValue.serverTimestamp() });
    });

    return { success: true, marketId, expiresAt };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
