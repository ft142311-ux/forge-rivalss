import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { resolveAuctionPrice, resolvePreviousAuctionBidEscrow, normalizeAuctionBalance, resolveAuctionCurrency, resolveAuctionMaxBid } from './auction-settlement';
import { resolveMarketBidExpiryMs, resolveMarketBidPrice } from './market-bid-guards';

function money(value: unknown) {
  return normalizeAuctionBalance(value);
}

async function assertStandardMarketSellerListing(tx: any, db: any, lot: any, marketId: string, now: number) {
  const sellerId = String(lot.sellerId || '');
  const playerId = String(lot.heroData?.id || lot.playerId || '');
  if (!sellerId || sellerId === 'system') throw new Error('MARKET_SELLER_UNAVAILABLE');
  if (!playerId) throw new Error('MARKET_PLAYER_UNAVAILABLE');

  const sellerRef = db.collection('players_v14').doc(sellerId);
  const sellerSnap = await tx.get(sellerRef);
  if (!sellerSnap.exists) throw new Error('MARKET_SELLER_UNAVAILABLE');
  const seller = sellerSnap.data() || {};
  if (seller.ownedPlayers !== undefined && seller.ownedPlayers !== null && !Array.isArray(seller.ownedPlayers)) {
    throw new Error('MARKET_SELLER_ROSTER_INVALID');
  }
  const players: any[] = Array.isArray(seller.ownedPlayers) ? [...seller.ownedPlayers] : [];
  const matches = players.filter(player => String(player?.id || '') === playerId);
  if (matches.length !== 1) throw new Error('MARKET_PLAYER_NOT_LISTED');

  const playerIndex = players.findIndex(player => String(player?.id || '') === playerId);
  const player = players[playerIndex];
  const lockId = String(player.transferMarketId || '').trim();
  if (lockId && lockId !== marketId) throw new Error('MARKET_LOT_STALE');
  if (player.onTransferUntil !== undefined && player.onTransferUntil !== null && player.onTransferUntil !== '') {
    const lockUntil = resolveMarketBidExpiryMs(player.onTransferUntil);
    if (lockUntil === null || lockUntil <= now) throw new Error('MARKET_LOT_STALE');
  }
  return { sellerRef, players, playerIndex };
}

async function assertYouthMarketSellerListing(tx: any, db: any, lot: any, marketId: string, lotExpiryMs: number) {
  const sellerId = String(lot.sellerId || '').trim();
  const playerId = String(lot.heroData?.id || lot.playerId || '').trim();
  if (!sellerId || sellerId === 'system') throw new Error('MARKET_SELLER_UNAVAILABLE');
  if (!playerId) throw new Error('MARKET_PLAYER_UNAVAILABLE');

  const sellerRef = db.collection('players_v14').doc(sellerId);
  const sellerSnap = await tx.get(sellerRef);
  if (!sellerSnap.exists) throw new Error('MARKET_SELLER_UNAVAILABLE');
  const seller = sellerSnap.data() || {};
  if (seller.youthAcademyPlayers !== undefined && seller.youthAcademyPlayers !== null &&
      !Array.isArray(seller.youthAcademyPlayers)) {
    throw new Error('MARKET_SELLER_ROSTER_INVALID');
  }
  const players: any[] = Array.isArray(seller.youthAcademyPlayers) ? [...seller.youthAcademyPlayers] : [];
  const matches = players.filter(player => String(player?.id || '') === playerId);
  if (matches.length !== 1) throw new Error('MARKET_PLAYER_NOT_LISTED');

  const playerIndex = players.findIndex(player => String(player?.id || '') === playerId);
  const player = players[playerIndex];
  const lockId = String(player.transferMarketId || '').trim();
  const lockUntil = resolveMarketBidExpiryMs(player.onTransferUntil);
  if (lockId !== marketId || lockUntil === null || lockUntil < lotExpiryMs) {
    throw new Error('MARKET_LOT_STALE');
  }
  return { sellerRef, players, playerIndex };
}

export async function placeSpecialMarketBidWithDb(
  db: any,
  uid: string,
  marketId: string,
  amount: number,
  marketKind: 'pro' | 'youth',
  now = Date.now(),
) {
  if (typeof marketId !== 'string' || !marketId.trim() || marketId.length > 180) throw new Error('INVALID_MARKET_LOT');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_BID');
  const bid = amount;

  const lotRef = db.collection('market_v7').doc(marketId);
  const bidderRef = db.collection('players_v14').doc(uid);
  const notificationRef = db.collection('notifications_v7').doc();
  const bidderLedgerRef = db.collection('economy_transactions').doc();
  const refundLedgerRef = db.collection('economy_transactions').doc();

  return db.runTransaction(async (tx: any) => {
    const resetConfigRef = db.collection('system_v1').doc('season_config');
    const [lotSnap, bidderSnap, resetConfigSnap] = await Promise.all([
      tx.get(lotRef), tx.get(bidderRef), tx.get(resetConfigRef),
    ]);
    if (resetConfigSnap.exists && (resetConfigSnap.data()?.stagingSeasonOneResetInProgress === true ||
        resetConfigSnap.data()?.stagingFreshSeasonOneReset === true)) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    if (!lotSnap.exists) throw new Error('MARKET_LOT_NOT_FOUND');
    if (!bidderSnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const lot: any = lotSnap.data() || {};
    if (lot.status === 'settled' || lot.status === 'expired') throw new Error('MARKET_LOT_NOT_ACTIVE');
    const bidder: any = bidderSnap.data() || {};
    const isExpectedLot = marketKind === 'pro'
      ? lot.isPro === true && lot.currency === 'crystals'
      : lot.isYouth === true && (lot.currency === undefined || lot.currency === null || lot.currency === '' || lot.currency === 'credits');
    if (!isExpectedLot) throw new Error('INVALID_MARKET_LOT_TYPE');
    if (String(lot.sellerId || '') === uid) throw new Error('SELLER_CANNOT_BID');

    const expiryMs = resolveMarketBidExpiryMs(lot.expiresAt);
    if (expiryMs === null) throw new Error('MARKET_EXPIRY_INVALID');
    if (expiryMs <= now) throw new Error('MARKET_LOT_EXPIRED');
    const youthSellerListing = marketKind === 'youth'
      ? await assertYouthMarketSellerListing(tx, db, lot, marketId, expiryMs)
      : null;

    const currentBid = resolveAuctionPrice(lot.currentBid, lot.startingPrice, 0);
    const minimumBid = Math.ceil(currentBid * 1.03);
    const maxBidBase = marketKind === 'youth'
      ? currentBid
      : resolveAuctionMaxBid(lot.startingPrice, currentBid);
    const defaultMaxBid = marketKind === 'youth' ? currentBid * 4 : maxBidBase * 3;
    const maxBid = resolveAuctionMaxBid(lot.maxBid, defaultMaxBid);
    if (!Number.isSafeInteger(minimumBid) || !Number.isSafeInteger(maxBid) || maxBid < minimumBid) {
      throw new Error('MARKET_BID_LIMITS_INVALID');
    }
    if (bid < minimumBid) throw new Error('BID_TOO_LOW');
    if (bid > maxBid) throw new Error('BID_TOO_HIGH');
    const currency = marketKind === 'pro' ? 'crystals' : 'credits';
    const previousBidderId = String(lot.highestBidderId || lot.highestBidderUid || '');
    if (previousBidderId && previousBidderId === String(lot.sellerId || '')) {
      throw new Error('MARKET_PREVIOUS_BIDDER_INVALID');
    }
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
    const nextExpiryIso = new Date(nextExpiry).toISOString();
    if (youthSellerListing && nextExpiry > expiryMs) {
      const youthPlayers = [...youthSellerListing.players];
      youthPlayers[youthSellerListing.playerIndex] = {
        ...youthPlayers[youthSellerListing.playerIndex],
        onTransferUntil: nextExpiryIso,
        transferMarketId: marketId,
      };
      tx.update(youthSellerListing.sellerRef, {
        youthAcademyPlayers: youthPlayers,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
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
      const previousBalance = money(previousBidder[currency]);
      const refundedBalance = previousBalance + refundAmount;
      if (!Number.isSafeInteger(refundedBalance)) throw new Error('AUCTION_BALANCE_INVALID');
      tx.update(previousBidderRef, {
        [currency]: refundedBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(refundLedgerRef, {
        userId: previousBidderId,
        amount: refundAmount,
        currency,
        type: 'SPECIAL_AUCTION_OUTBID_REFUND',
        referenceId: marketId,
        description: `Refund after being outbid in ${marketKind} market`,
        balanceBefore: previousBalance,
        balanceAfter: refundedBalance,
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
      expiresAt: nextExpiryIso,
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



/**
 * Standard transfer-market bid transaction, exported for Firebase Emulator
 * integration coverage. The server action remains responsible for identity.
 */
export async function placeStandardMarketBidWithDb(
  db: any,
  uid: string,
  marketId: string,
  amount: number,
) {
  if (typeof marketId !== 'string' || !marketId.trim() || marketId.length > 180 ||
      typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_BID');
  }

  const bidderLedgerRef = db.collection('economy_transactions').doc();
  const refundLedgerRef = db.collection('economy_transactions').doc();

  return db.runTransaction(async (tx: any) => {
    const marketRef = db.collection('market_v7').doc(marketId);
    const bidderRef = db.collection('players_v14').doc(uid);
    const resetConfigRef = db.collection('system_v1').doc('season_config');
    const [marketSnap, resetConfigSnap] = await Promise.all([tx.get(marketRef), tx.get(resetConfigRef)]);
    if (resetConfigSnap.exists && (resetConfigSnap.data()?.stagingSeasonOneResetInProgress === true ||
        resetConfigSnap.data()?.stagingFreshSeasonOneReset === true)) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    if (!marketSnap.exists) throw new Error('MARKET_LOT_NOT_FOUND');

    const lot: any = marketSnap.data() || {};
    if (lot.status === 'settled' || lot.status === 'expired') throw new Error('MARKET_LOT_NOT_ACTIVE');
    if (lot.isPro === true || lot.isYouth === true) throw new Error('INVALID_MARKET_LOT_TYPE');
    const sellerId = String(lot.sellerId || '');
    if (sellerId === uid) throw new Error('SELLER_CANNOT_BID');

    const currency = resolveAuctionCurrency(lot.currency);
    if (currency !== 'credits') throw new Error('INVALID_MARKET_CURRENCY');

    const expiresAt = resolveMarketBidExpiryMs(lot.expiresAt);
    if (expiresAt === null) throw new Error('MARKET_EXPIRY_INVALID');
    const now = Date.now();
    if (expiresAt <= now) throw new Error('MARKET_LOT_EXPIRED');
    const sellerListing = await assertStandardMarketSellerListing(tx, db, lot, marketId, now);

    const currentBid = resolveMarketBidPrice(lot.currentBid, lot.startingPrice);
    if (currentBid === null) throw new Error('MARKET_PRICE_INVALID');
    const minimumBid = Math.ceil(currentBid * 1.03);
    const maxBidBase = resolveAuctionMaxBid(lot.startingPrice, currentBid);
    const maxBid = resolveAuctionMaxBid(lot.maxBid, maxBidBase * 3);
    if (!Number.isSafeInteger(minimumBid) || !Number.isSafeInteger(maxBid) || maxBid < minimumBid) {
      throw new Error('MARKET_BID_LIMITS_INVALID');
    }
    if (amount < minimumBid) throw new Error('BID_TOO_LOW');
    if (amount > maxBid) throw new Error('BID_TOO_HIGH');

    const bidderSnap = await tx.get(bidderRef);
    if (!bidderSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    const bidderData: any = bidderSnap.data() || {};

    const previousBidderId = String(lot.highestBidderId || lot.highestBidderUid || '');
    // A legacy or corrupt lot must not refund a seller-funded self-bid to the seller
    // while allowing a third party to buy the player at the inflated price.
    if (previousBidderId && previousBidderId === sellerId) {
      throw new Error('MARKET_PREVIOUS_BIDDER_INVALID');
    }
    const previousEscrow = resolvePreviousAuctionBidEscrow({
      currency,
      escrowCurrency: lot.escrowCurrency,
      escrowedAmount: lot.escrowedAmount,
      currentBid,
      previousBidderId,
    });
    const sameEscrowedBidder = previousBidderId === uid && previousEscrow === currentBid;
    const chargeAmount = sameEscrowedBidder ? amount - currentBid : amount;
    const bidderBalance = normalizeAuctionBalance(bidderData.credits);
    if (!Number.isSafeInteger(bidderBalance - chargeAmount) || bidderBalance < chargeAmount) throw new Error('INSUFFICIENT_FUNDS');

    let previousBidderRef: DocumentReference | null = null;
    let previousBidder: any = null;
    if (previousBidderId && previousBidderId !== uid && previousEscrow > 0) {
      previousBidderRef = db.collection('players_v14').doc(previousBidderId);
      const previousBidderSnap = await tx.get(previousBidderRef);
      if (!previousBidderSnap.exists) throw new Error('PREVIOUS_BIDDER_NOT_FOUND');
      previousBidder = previousBidderSnap.data() || {};
    }

    const displayName = String(bidderData.displayName || bidderData.name || 'Manager').slice(0, 80);
    const previousBidders = Array.isArray(lot.bidders) ? [...lot.bidders] : [];
    const bidders = previousBidders.filter((entry: any) => {
      const id = typeof entry === 'string' ? entry : entry?.userId || entry?.bidderId || entry?.uid;
      return id !== uid;
    });
    // My Bids uses Firestore array-contains on the UID; keep this field string-based.
    bidders.push(uid);

    const nextExpiry = expiresAt - now < 10 * 60 * 1000 ? now + 10 * 60 * 1000 : expiresAt;
    if (nextExpiry > expiresAt) {
      const sellerPlayers = [...sellerListing.players];
      sellerPlayers[sellerListing.playerIndex] = {
        ...sellerPlayers[sellerListing.playerIndex],
        onTransferUntil: new Date(nextExpiry).toISOString(),
        transferMarketId: marketId,
      };
      tx.update(sellerListing.sellerRef, {
        ownedPlayers: sellerPlayers,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(bidderRef, {
      credits: bidderBalance - chargeAmount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(bidderLedgerRef, {
      userId: uid,
      amount: -chargeAmount,
      currency,
      type: 'SPECIAL_AUCTION_BID_ESCROW',
      referenceId: marketId,
      description: 'Escrow for standard transfer-market bid',
      balanceBefore: bidderBalance,
      balanceAfter: bidderBalance - chargeAmount,
      timestamp: FieldValue.serverTimestamp(),
    });

    if (previousBidderRef && previousBidder) {
      const previousBalance = normalizeAuctionBalance(previousBidder.credits);
      const refundedBalance = previousBalance + previousEscrow;
      if (!Number.isSafeInteger(refundedBalance)) throw new Error('AUCTION_BALANCE_INVALID');
      tx.update(previousBidderRef, {
        credits: refundedBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(refundLedgerRef, {
        userId: previousBidderId,
        amount: previousEscrow,
        currency,
        type: 'SPECIAL_AUCTION_OUTBID_REFUND',
        referenceId: marketId,
        description: 'Refund after being outbid in standard transfer market',
        balanceBefore: previousBalance,
        balanceAfter: refundedBalance,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    tx.update(marketRef, {
      currentBid: amount,
      highestBidderId: uid,
      highestBidderName: displayName,
      bidders,
      escrowedAmount: amount,
      escrowCurrency: currency,
      expiresAt: new Date(nextExpiry).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      marketId,
      currentBid: amount,
      highestBidderId: uid,
      expiresAt: new Date(nextExpiry).toISOString(),
    };
  });
}
