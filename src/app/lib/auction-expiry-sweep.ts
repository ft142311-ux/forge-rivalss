import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { isSystemAuctionSeller, normalizeAuctionBalance, resolveAuctionCurrency, resolveAuctionEscrow, resolveAuctionPrice, normalizeAuctionUserId, resolveAuctionBidderId } from './auction-settlement';
import { resolveMarketBidExpiryMs } from './market-bid-guards';

/**
 * Finalizes expired transfer-market listings from the server only.
 *
 * A listing is settled exactly once: the market document is re-read inside a
 * Firestore transaction and deleted only after the seller/buyer/player state is
 * reconciled. If the leading bidder is no longer eligible, the lot expires
 * without a sale and the seller's player is unlocked.
 */
async function settleCandidate(candidate: any, db: any, nowMs = Date.now()) {
    const transferRef = db.collection('transfer_history').doc();
    try {
      const result = await db.runTransaction(async (tx: any) => {
        const lotRef = db.collection('market_v7').doc(candidate.id);
        const resetConfigRef = db.collection('system_v1').doc('season_config');
        const [lotSnap, resetConfigSnap] = await Promise.all([tx.get(lotRef), tx.get(resetConfigRef)]);
        // Recheck inside the settlement transaction: a sweep may have acquired
        // its lease before the reset marker was asserted.
        if (resetConfigSnap.exists && (resetConfigSnap.data()?.stagingSeasonOneResetInProgress === true ||
            resetConfigSnap.data()?.stagingFreshSeasonOneReset === true)) {
          return 'SKIPPED';
        }
        if (!lotSnap.exists) return 'SKIPPED';
        const lot: any = lotSnap.data() || {};
        if (lot.status === 'settled' || lot.status === 'expired') return 'SKIPPED';
        const expiryMs = resolveMarketBidExpiryMs(lot.expiresAt);
        if (expiryMs === null || expiryMs > nowMs) return 'SKIPPED';

        const sellerId = normalizeAuctionUserId(lot.sellerId);
        const bidderId = resolveAuctionBidderId(lot);
        const price = resolveAuctionPrice(lot.currentBid, lot.startingPrice, lot.price);
        const playerId = String(lot.heroData?.id || '').trim() || String(lot.playerId || '').trim();

        const isSystemSeller = isSystemAuctionSeller(sellerId, lot.isSystem);
        const currency = resolveAuctionCurrency(lot.currency);
        const sellerRef = isSystemSeller || !sellerId ? null : db.collection('players_v14').doc(sellerId);
        const buyerRef = bidderId ? db.collection('players_v14').doc(bidderId) : null;
        const sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
        const buyerSnap = buyerRef ? await tx.get(buyerRef) : null;
        const seller: any = sellerSnap?.exists ? sellerSnap.data() || {} : {};
        const buyer: any = buyerSnap?.exists ? buyerSnap.data() || {} : {};
        const playerArrayKey = lot.isYouth === true ? 'youthAcademyPlayers' : 'ownedPlayers';
        const rawSellerPlayers = seller[playerArrayKey];
        const rawBuyerPlayers = buyer[playerArrayKey];
        if (sellerSnap?.exists && rawSellerPlayers !== undefined && rawSellerPlayers !== null && !Array.isArray(rawSellerPlayers)) {
          throw new Error('AUCTION_SELLER_ROSTER_INVALID');
        }
        if (buyerSnap?.exists && rawBuyerPlayers !== undefined && rawBuyerPlayers !== null && !Array.isArray(rawBuyerPlayers)) {
          throw new Error('AUCTION_BUYER_ROSTER_INVALID');
        }
        const sellerPlayers: any[] = Array.isArray(rawSellerPlayers) ? [...rawSellerPlayers] : [];
        const sellerMatches = sellerPlayers.filter((player: any) => String(player?.id) === playerId).length;
        if (sellerMatches > 1) throw new Error('AUCTION_SELLER_PLAYER_DUPLICATE');
        const sellerIndex = sellerPlayers.findIndex((player: any) => String(player?.id) === playerId);
        const sellerPlayerLockId = sellerIndex >= 0
          ? String(sellerPlayers[sellerIndex]?.transferMarketId || '').trim()
          : '';
        // A stale lot must not sell or unlock a player already reserved by a
        // newer listing. Missing lock IDs remain compatible with legacy lots.
        const sellerPlayerLockIdMatchesLot = !sellerPlayerLockId || sellerPlayerLockId === candidate.id;
        const sellerLockUntilMs = sellerIndex >= 0
          ? resolveMarketBidExpiryMs(sellerPlayers[sellerIndex]?.onTransferUntil)
          : null;
        // Youth listings reserve a real academy player. Their lock must cover
        // the lot's full current expiry, including any anti-sniping extension.
        const sellerPlayerLockCoversLot = lot.isYouth !== true || !sellerPlayerLockId ||
          (sellerLockUntilMs !== null && sellerLockUntilMs >= expiryMs);
        const sellerPlayerLockMatchesLot = sellerPlayerLockIdMatchesLot && sellerPlayerLockCoversLot;
        const systemPlayer: any = isSystemSeller && lot.heroData?.id === playerId ? lot.heroData : null;
        const buyerPlayers: any[] = Array.isArray(rawBuyerPlayers) ? [...rawBuyerPlayers] : [];
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
        const sellerExists = isSystemSeller ? Boolean(systemPlayer) : Boolean(sellerSnap?.exists && sellerMatches === 1 && sellerPlayerLockMatchesLot);
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
            if (!Number.isSafeInteger(sellerAfter)) throw new Error('AUCTION_BALANCE_INVALID');
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

        // No valid winner: unlock the seller's player and refund any recorded escrow.
        // A malformed/legacy lot can name the seller as its own bidder. In that
        // case the buyer and seller references are the same document, so combine
        // the refund and unlock into one update rather than leaving the escrow stuck.
        const shouldUnlockSellerPlayer = Boolean(sellerRef && sellerSnap?.exists && sellerIndex >= 0 && sellerPlayerLockIdMatchesLot);
        if (hasRecordedEscrow && buyerRef && buyerSnap?.exists) {
          const refundedBalance = buyerBalance + escrowedAmount;
          if (!Number.isSafeInteger(refundedBalance)) throw new Error('AUCTION_BALANCE_INVALID');
          const buyerPatch: any = {
            [currency]: refundedBalance,
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (shouldUnlockSellerPlayer && sellerRef!.path === buyerRef.path) {
            sellerPlayers[sellerIndex] = { ...sellerPlayers[sellerIndex], onTransferUntil: null, transferMarketId: null };
            buyerPatch[playerArrayKey] = sellerPlayers;
          } else if (shouldUnlockSellerPlayer) {
            sellerPlayers[sellerIndex] = { ...sellerPlayers[sellerIndex], onTransferUntil: null, transferMarketId: null };
            tx.update(sellerRef!, { [playerArrayKey]: sellerPlayers, updatedAt: FieldValue.serverTimestamp() });
          }
          tx.update(buyerRef, buyerPatch);
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
        } else if (shouldUnlockSellerPlayer) {
          sellerPlayers[sellerIndex] = { ...sellerPlayers[sellerIndex], onTransferUntil: null, transferMarketId: null };
          tx.update(sellerRef!, { [playerArrayKey]: sellerPlayers, updatedAt: FieldValue.serverTimestamp() });
        }
        tx.delete(lotRef);
        return 'EXPIRED';
      });
      return { result, error: null as null };
    } catch (error: any) {
      return { result: null as null, error: { id: candidate.id, error: error?.message || 'MARKET_SETTLEMENT_FAILED' } };
    }
}

export async function runTransferMarketExpirySweepWithDb(
  db: any,
  options: { maxRuntimeMs?: number; maxPages?: number; pageSize?: number; concurrency?: number; now?: () => number } = {},
) {
  const now = options.now || (() => Date.now());
  const startedAt = now();
  const initialConfig = await db.collection('system_v1').doc('season_config').get();
  if (initialConfig.exists && (initialConfig.data()?.stagingSeasonOneResetInProgress === true ||
      initialConfig.data()?.stagingFreshSeasonOneReset === true)) {
    return { success: true, skipped: true, reason: 'STAGING_SEASON_ONE_RESET_IN_PROGRESS', scanned: 0, settled: 0 };
  }
  const maxRuntimeMs = Number.isSafeInteger(options.maxRuntimeMs) && options.maxRuntimeMs! > 0
    ? options.maxRuntimeMs!
    : 210_000;
  const maxPages = Number.isSafeInteger(options.maxPages) && options.maxPages! > 0
    ? options.maxPages!
    : Number.POSITIVE_INFINITY;
  const pageSize = Number.isSafeInteger(options.pageSize) && options.pageSize! > 0
    ? options.pageSize!
    : 200;
  const concurrency = Number.isSafeInteger(options.concurrency) && options.concurrency! > 0
    ? Math.min(options.concurrency!, 4)
    : 4;
  const leaseMs = 360_000;
  const market = db.collection('market_v7');
  const stateRef = db.collection('system_jobs_v1').doc('market_expiry_sweep');
  const ownerToken = randomUUID();
  const errors: Array<{ id: string; error: string }> = [];
  let scanned = 0;
  let dueCount = 0;
  let settled = 0;
  let sold = 0;
  let expiredWithoutSale = 0;
  let skipped = 0;
  let pages = 0;
  let cursorId: string | null = null;
  let leaseAcquired = false;
  let complete = false;
  let continuation = false;

  const configRef = db.collection('system_v1').doc('season_config');
  const lease = await db.runTransaction(async (tx: any) => {
    const [snapshot, configSnap] = await Promise.all([tx.get(stateRef), tx.get(configRef)]);
    if (configSnap.exists && (configSnap.data()?.stagingSeasonOneResetInProgress === true ||
        configSnap.data()?.stagingFreshSeasonOneReset === true)) {
      return { acquired: false, cursorId: null, resetInProgress: true };
    }
    const state = snapshot.exists ? snapshot.data() || {} : {};
    const activeUntil = typeof state.leaseUntilMs === 'number' ? state.leaseUntilMs : 0;
    if (typeof state.leaseOwner === 'string' && state.leaseOwner && activeUntil > now()) {
      return { acquired: false, cursorId: null };
    }
    const savedCursor = typeof state.cursorId === 'string' && state.cursorId ? state.cursorId : null;
    tx.set(stateRef, {
      leaseOwner: ownerToken,
      leaseUntilMs: now() + leaseMs,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { acquired: true, cursorId: savedCursor };
  });

  if (!lease.acquired && lease.resetInProgress) {
    return {
      success: true, complete: false, continuation: false, busy: false,
      skipped: true, reason: 'STAGING_SEASON_ONE_RESET_IN_PROGRESS', scanned: 0, settled: 0,
    };
  }

  if (!lease.acquired) {
    return {
      success: false, complete: false, continuation: true, busy: true,
      scanned, due: dueCount, settled, sold, expiredWithoutSale, skipped,
      errors: [{ id: 'market_expiry_sweep', error: 'MARKET_EXPIRY_SWEEP_BUSY' }],
    };
  }

  leaseAcquired = true;
  cursorId = lease.cursorId;

  const saveProgress = async (nextCursorId: string | null, finished: boolean) => {
    await db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(stateRef);
      const state = snapshot.exists ? snapshot.data() || {} : {};
      if (state.leaseOwner !== ownerToken) throw new Error('MARKET_EXPIRY_LEASE_LOST');
      tx.set(stateRef, {
        cursorId: finished ? null : nextCursorId,
        leaseOwner: finished ? null : ownerToken,
        leaseUntilMs: finished ? 0 : now() + leaseMs,
        updatedAt: FieldValue.serverTimestamp(),
        ...(finished ? { lastCompletedAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
    });
    leaseAcquired = !finished;
  };

  try {
    while (true) {
      if (now() - startedAt >= maxRuntimeMs || pages >= maxPages) {
        continuation = true;
        break;
      }

      let query = market.orderBy(FieldPath.documentId()).limit(pageSize);
      if (cursorId) query = query.startAfter(cursorId);
      const page = await query.get();
      if (page.empty) {
        complete = true;
        await saveProgress(null, true);
        break;
      }

      scanned += page.size;
      pages++;
      const pageDue: any[] = [];
      for (const doc of page.docs) {
        const lot = doc.data() || {};
        if (lot.status === 'settled' || lot.status === 'expired') continue;
        const expiresAt = resolveMarketBidExpiryMs(lot.expiresAt);
        if (expiresAt !== null && expiresAt <= now()) pageDue.push(doc);
      }

      dueCount += pageDue.length;
      let pageCompleted = true;
      for (let offset = 0; offset < pageDue.length; offset += concurrency) {
        if (now() - startedAt >= maxRuntimeMs) {
          pageCompleted = false;
          continuation = true;
          break;
        }
        const outcomes = await Promise.all(
          pageDue.slice(offset, offset + concurrency).map((candidate) => settleCandidate(candidate, db, now())),
        );
        for (const outcome of outcomes) {
          if (outcome.error) {
            if (errors.length < 50) errors.push(outcome.error);
          } else if (outcome.result === 'SOLD') {
            settled++;
            sold++;
          } else if (outcome.result === 'EXPIRED') {
            settled++;
            expiredWithoutSale++;
          } else {
            skipped++;
          }
        }
      }

      // Never advance beyond a partially processed page. Settled lots are
      // idempotently skipped on retry, while unprocessed lots remain reachable.
      if (!pageCompleted) break;

      cursorId = page.docs[page.docs.length - 1].id;
      const lastPage = page.size < pageSize;
      if (lastPage) {
        complete = true;
        await saveProgress(null, true);
        break;
      }
      await saveProgress(cursorId, false);
    }
  } finally {
    if (leaseAcquired) {
      await db.runTransaction(async (tx: any) => {
        const snapshot = await tx.get(stateRef);
        const state = snapshot.exists ? snapshot.data() || {} : {};
        if (state.leaseOwner === ownerToken) {
          tx.set(stateRef, {
            leaseOwner: null,
            leaseUntilMs: 0,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
    }
  }

  return {
    success: errors.length === 0,
    complete,
    continuation: continuation || !complete,
    busy: false,
    scanned,
    due: dueCount,
    settled,
    sold,
    expiredWithoutSale,
    skipped,
    errors: errors.slice(0, 50),
  };
}
