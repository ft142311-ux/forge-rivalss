import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { isSystemAuctionSeller, normalizeAuctionBalance, resolveAuctionCurrency, resolveAuctionEscrow, resolveAuctionPrice } from './auction-settlement';

/**
 * Finalizes expired transfer-market listings from the server only.
 *
 * A listing is settled exactly once: the market document is re-read inside a
 * Firestore transaction and deleted only after the seller/buyer/player state is
 * reconciled. If the leading bidder is no longer eligible, the lot expires
 * without a sale and the seller's player is unlocked.
 */
export async function runTransferMarketExpirySweepWithDb(db: any) {
  const now = Date.now();
  const market = db.collection('market_v7');
  const pageSize = 200;
  let cursor: any = null;
  let scanned = 0;
  const due: any[] = [];

  // Avoid an unbounded collection read while still scanning every listing.
  // Document-ID pagination is stable even when lots are deleted as they settle.
  while (true) {
    let query = market.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    scanned += page.size;
    for (const doc of page.docs) {
      const lot = doc.data() || {};
      if (lot.status === 'settled' || lot.status === 'expired') continue;
      const raw = lot.expiresAt;
      const expiresAt = raw && typeof raw.toMillis === 'function'
        ? raw.toMillis()
        : raw instanceof Date
          ? raw.getTime()
          : typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Date.parse(raw)
              : NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= now) due.push(doc);
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }

  let settled = 0;
  let sold = 0;
  let expiredWithoutSale = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const candidate of due) {
    const transferRef = db.collection('transfer_history').doc();
    try {
      const result = await db.runTransaction(async (tx: any) => {
        const lotRef = db.collection('market_v7').doc(candidate.id);
        const lotSnap = await tx.get(lotRef);
        if (!lotSnap.exists) return 'SKIPPED';
        const lot: any = lotSnap.data() || {};
        if (lot.status === 'settled' || lot.status === 'expired') return 'SKIPPED';
        const rawExpiry = lot.expiresAt;
        const expiryMs = rawExpiry && typeof rawExpiry.toMillis === 'function'
          ? rawExpiry.toMillis()
          : rawExpiry instanceof Date
            ? rawExpiry.getTime()
            : typeof rawExpiry === 'number'
              ? rawExpiry
              : typeof rawExpiry === 'string'
                ? Date.parse(rawExpiry)
                : NaN;
        if (!Number.isFinite(expiryMs) || expiryMs > Date.now()) return 'SKIPPED';

        const sellerId = String(lot.sellerId || '');
        const bidderId = String(lot.highestBidderId || lot.highestBidderUid || '');
        const price = resolveAuctionPrice(lot.currentBid, lot.startingPrice, lot.price);
        const playerId = String(lot.heroData?.id || lot.playerId || '');

        const isSystemSeller = isSystemAuctionSeller(sellerId, lot.isSystem);
        const currency = resolveAuctionCurrency(lot.currency);
        const sellerRef = isSystemSeller || !sellerId ? null : db.collection('players_v14').doc(sellerId);
        const buyerRef = bidderId && bidderId !== sellerId ? db.collection('players_v14').doc(bidderId) : null;
        const sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
        const buyerSnap = buyerRef ? await tx.get(buyerRef) : null;
        const seller: any = sellerSnap?.exists ? sellerSnap.data() || {} : {};
        const buyer: any = buyerSnap?.exists ? buyerSnap.data() || {} : {};
        const playerArrayKey = lot.isYouth === true ? 'youthAcademyPlayers' : 'ownedPlayers';
        const sellerPlayers: any[] = Array.isArray(seller[playerArrayKey]) ? [...seller[playerArrayKey]] : [];
        const sellerIndex = sellerPlayers.findIndex((player: any) => String(player?.id) === playerId);
        const systemPlayer: any = isSystemSeller && lot.heroData?.id === playerId ? lot.heroData : null;
        const buyerPlayers: any[] = Array.isArray(buyer[playerArrayKey]) ? [...buyer[playerArrayKey]] : [];
        const buyerBalance = normalizeAuctionBalance(buyer[currency]);
        const escrow = resolveAuctionEscrow({
          currency,
          escrowCurrency: lot.escrowCurrency,
          escrowedAmount: lot.escrowedAmount,
          price,
          bidderId,
          buyerExists: Boolean(buyerSnap?.exists),
        });
        const escrowedAmount = escrow.amount;
        const hasRecordedEscrow = escrow.hasRecordedEscrow;
        const hasValidEscrow = escrow.hasValidEscrow;
        const sellerExists = isSystemSeller ? Boolean(systemPlayer) : Boolean(sellerSnap?.exists && sellerIndex >= 0);
        const validSale = Boolean(
          sellerExists && buyerSnap?.exists && buyerRef && bidderId !== sellerId && price > 0 &&
          (hasValidEscrow || buyerBalance >= price) &&
          !buyerPlayers.some((player: any) => String(player?.id) === playerId)
        );

        if (validSale) {
          const sourcePlayer = isSystemSeller ? systemPlayer : sellerPlayers[sellerIndex];
          const player = { ...sourcePlayer, onTransferUntil: null, transferMarketId: null };
          if (!isSystemSeller) sellerPlayers.splice(sellerIndex, 1);
          buyerPlayers.push(player);
          const commission = isSystemSeller ? 0 : Math.floor(price * 0.05);
          const sellerIncome = price - commission;
          tx.update(buyerRef!, { ...(hasValidEscrow ? {} : { [currency]: buyerBalance - price }), [playerArrayKey]: buyerPlayers, updatedAt: FieldValue.serverTimestamp() });
          if (!hasValidEscrow) {
            tx.set(db.collection('economy_transactions').doc(`auction_settlement_${candidate.id}_buyer`), {
              userId: bidderId,
              amount: -price,
              currency,
              type: 'SPECIAL_AUCTION_SETTLEMENT_DEBIT',
              referenceId: candidate.id,
              description: 'Auction settlement debit (legacy listing without valid escrow)',
              balanceBefore: buyerBalance,
              balanceAfter: buyerBalance - price,
              timestamp: FieldValue.serverTimestamp(),
            });
          }
          if (sellerRef) {
            const sellerBefore = normalizeAuctionBalance(seller[currency]);
            const sellerAfter = sellerBefore + sellerIncome;
            tx.update(sellerRef, {
              [currency]: sellerAfter,
              [playerArrayKey]: sellerPlayers,
              updatedAt: FieldValue.serverTimestamp(),
            });
            tx.set(db.collection('economy_transactions').doc(`auction_settlement_${candidate.id}_seller`), {
              userId: sellerId,
              amount: sellerIncome,
              currency,
              type: 'SPECIAL_AUCTION_SETTLEMENT_CREDIT',
              referenceId: candidate.id,
              description: 'Auction sale proceeds after commission',
              balanceBefore: sellerBefore,
              balanceAfter: sellerAfter,
              timestamp: FieldValue.serverTimestamp(),
            });
          }
          tx.set(transferRef, {
            playerId, playerName: player.name || lot.heroData?.name || 'Player',
            buyerId: bidderId, sellerId, price, currency, commission, sellerIncome,
            marketId: candidate.id, createdAt: FieldValue.serverTimestamp(), settlement: 'expired-auction',
            sellerType: isSystemSeller ? 'system' : 'manager',
          });
          tx.delete(lotRef);
          return 'SOLD';
        }

        // No valid winner: unlock a manager-owned player when present, then remove the expired listing.
        if (sellerRef && sellerSnap?.exists && sellerIndex >= 0) {
          sellerPlayers[sellerIndex] = { ...sellerPlayers[sellerIndex], onTransferUntil: null, transferMarketId: null };
          tx.update(sellerRef, { [playerArrayKey]: sellerPlayers, updatedAt: FieldValue.serverTimestamp() });
        }
        if (hasRecordedEscrow && buyerRef && buyerSnap?.exists) {
          const refundedBalance = buyerBalance + escrowedAmount;
          tx.update(buyerRef, {
            [currency]: refundedBalance,
            updatedAt: FieldValue.serverTimestamp(),
          });
          const refundRef = db.collection('economy_transactions').doc(`auction_settlement_${candidate.id}_refund`);
          tx.set(refundRef, {
            userId: bidderId,
            amount: escrowedAmount,
            currency,
            type: 'SPECIAL_AUCTION_SETTLEMENT_REFUND',
            referenceId: candidate.id,
            description: 'Refund for an auction that could not be settled',
            balanceBefore: buyerBalance,
            balanceAfter: refundedBalance,
            timestamp: FieldValue.serverTimestamp(),
          });
        }
        tx.delete(lotRef);
        return 'EXPIRED';
      });
      if (result === 'SOLD') { settled++; sold++; }
      else if (result === 'EXPIRED') { settled++; expiredWithoutSale++; }
      else skipped++;
    } catch (error: any) {
      errors.push({ id: candidate.id, error: error?.message || 'MARKET_SETTLEMENT_FAILED' });
    }
  }

  return {
    success: errors.length === 0,
    scanned,
    due: due.length,
    settled,
    sold,
    expiredWithoutSale,
    skipped,
    errors: errors.slice(0, 50),
  };
}
