import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { resolveAuctionPrice, resolvePreviousAuctionBidEscrow } from './auction-settlement';

function money(value: unknown) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export async function placeSpecialMarketBidWithDb(
  db: any,
  uid: string,
  marketId: string,
  amount: number,
  marketKind: 'pro' | 'youth',
  now = Date.now(),
) {
  if (!marketId || marketId.length > 180) throw new Error('INVALID_MARKET_LOT');
  const bid = Number(amount);
  if (!Number.isSafeInteger(bid) || bid <= 0) throw new Error('INVALID_BID');

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
    if (!Number.isFinite(expiryMs) || expiryMs <= now) throw new Error('MARKET_LOT_EXPIRED');

    const currentBid = resolveAuctionPrice(lot.currentBid, lot.startingPrice, 0);
    if (bid <= currentBid) throw new Error('BID_TOO_LOW');
    const currency = marketKind === 'pro' ? 'crystals' : 'credits';
    const previousBidderId = String(lot.highestBidderId || lot.highestBidderUid || '');
    const previousEscrow = resolvePreviousAuctionBidEscrow({
      currency,
      escrowCurrency: lot.escrowCurrency,
      escrowedAmount: lot.escrowedAmount,
      currentBid,
      previousBidderId,
    });
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
      balanceBefore: bidderBalance,
      balanceAfter: bidderBalance - chargeAmount,
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
        balanceBefore: money(previousBidder[currency]),
        balanceAfter: money(previousBidder[currency]) + refundAmount,
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

