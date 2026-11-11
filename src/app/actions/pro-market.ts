'use server';

import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { generateVtunePlayer } from '@/app/lib/moba-data';
import { getMoscowDateString, getMoscowTime } from '@/app/lib/time-utils';

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

      for (const oldLot of systemLots.docs) {
        if (oldLot.id !== lotId) tx.delete(oldLot.ref);
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

      return { created: !currentLot.exists, removed: systemLots.docs.filter((doc) => doc.id !== lotId).length };
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
  if (!marketId || marketId.length > 180) throw new Error('INVALID_MARKET_LOT');
  const bid = Number(amount);
  if (!Number.isSafeInteger(bid) || bid <= 0) throw new Error('INVALID_BID');

  const db = getAdminDb();
  const lotRef = db.collection('market_v7').doc(marketId);
  const bidderRef = db.collection('players_v14').doc(uid);
  const notificationRef = db.collection('notifications_v7').doc();
  const bidderLedgerRef = db.collection('economy_transactions').doc();
  const refundLedgerRef = db.collection('economy_transactions').doc();

  return db.runTransaction(async (tx) => {
    const [lotSnap, bidderSnap] = await Promise.all([tx.get(lotRef), tx.get(bidderRef)]);
    if (!lotSnap.exists) throw new Error('MARKET_LOT_NOT_FOUND');
    if (!bidderSnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const lot: any = lotSnap.data() || {};
    const bidder: any = bidderSnap.data() || {};
    const isExpectedLot = marketKind === 'pro'
      ? lot.isPro === true && lot.currency === 'crystals'
      : lot.isYouth === true && (lot.currency === undefined || lot.currency === null || lot.currency === '' || lot.currency === 'credits');
    if (!isExpectedLot) throw new Error('INVALID_MARKET_LOT_TYPE');
    if (String(lot.sellerId || '') === uid) throw new Error('SELLER_CANNOT_BID');

    const rawExpiry = lot.expiresAt;
    const expiryMs = rawExpiry?.toMillis?.() ?? (typeof rawExpiry === 'number' ? rawExpiry : Date.parse(String(rawExpiry || '')));
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) throw new Error('MARKET_LOT_EXPIRED');

    const currentBid = money(lot.currentBid || lot.startingPrice || 0);
    if (bid <= currentBid) throw new Error('BID_TOO_LOW');
    const currency = marketKind === 'pro' ? 'crystals' : 'credits';
    const previousBidderId = String(lot.highestBidderId || '');
    const previousEscrow = lot.escrowCurrency === currency ? money(lot.escrowedAmount) : 0;
    if (previousEscrow > 0 && (!previousBidderId || previousEscrow !== currentBid)) {
      throw new Error('AUCTION_ESCROW_MISMATCH');
    }
    const sameEscrowedBidder = previousBidderId === uid && previousEscrow === currentBid;
    const chargeAmount = sameEscrowedBidder ? bid - currentBid : bid;
    const bidderBalance = money(bidder[currency]);
    if (bidderBalance < chargeAmount) throw new Error(currency === 'crystals' ? 'INSUFFICIENT_CRYSTALS' : 'INSUFFICIENT_FUNDS');

    let previousBidderRef: DocumentReference | null = null;
    let previousBidder: any = null;
    if (previousBidderId && previousBidderId !== uid && previousEscrow > 0) {
      previousBidderRef = db.collection('players_v14').doc(previousBidderId);
      const previousBidderSnap = await tx.get(previousBidderRef);
      if (!previousBidderSnap.exists) throw new Error('PREVIOUS_BIDDER_NOT_FOUND');
      previousBidder = previousBidderSnap.data() || {};
    }

    const bidderName = String(bidder.displayName || bidder.clubName || 'Manager').slice(0, 80);
    const bidders = Array.isArray(lot.bidders) ? [...lot.bidders] : [];
    if (!bidders.some((entry: any) => entry === uid || entry?.userId === uid || entry?.bidderId === uid || entry?.uid === uid)) {
      bidders.push(uid);
    }

    const now = Date.now();
    const nextExpiry = expiryMs - now < 10 * 60 * 1000 ? now + 10 * 60 * 1000 : expiryMs;
    tx.update(bidderRef, {
      [currency]: bidderBalance - chargeAmount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(bidderLedgerRef, {
      userId: uid,
      amount: -chargeAmount,
      currency,
      type: 'SPECIAL_AUCTION_BID_ESCROW',
      referenceId: marketId,
      description: `Escrow for ${marketKind} market bid`,
      timestamp: FieldValue.serverTimestamp(),
    });

    if (previousBidderRef && previousBidder) {
      const refundAmount = previousEscrow;
      tx.update(previousBidderRef, {
        [currency]: money(previousBidder[currency]) + refundAmount,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(refundLedgerRef, {
        userId: previousBidderId,
        amount: refundAmount,
        currency,
        type: 'SPECIAL_AUCTION_OUTBID_REFUND',
        referenceId: marketId,
        description: `Refund after being outbid in ${marketKind} market`,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    tx.update(lotRef, {
      currentBid: bid,
      highestBidderId: uid,
      highestBidderName: bidderName,
      bidders,
      escrowedAmount: bid,
      escrowCurrency: currency,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(nextExpiry).toISOString(),
    });

    if (previousBidderId && previousBidderId !== uid) {
      tx.set(notificationRef, {
        userId: previousBidderId,
        title: 'Ставка перебита!',
        description: `Ставка на игрока "${String(lot.heroData?.name || 'Player').slice(0, 80)}" перебита.`,
        type: 'market',
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      marketId,
      currentBid: bid,
      highestBidderId: uid,
      previousBidderId: previousBidderId || null,
      expiresAt: new Date(nextExpiry).toISOString(),
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
