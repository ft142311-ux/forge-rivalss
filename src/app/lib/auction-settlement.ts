export type AuctionCurrency = 'credits' | 'crystals';

/** Legacy lots without a currency field are credit-denominated. */
export function resolveAuctionCurrency(value: unknown): AuctionCurrency {
  if (value === undefined || value === null || value === '') return 'credits';
  if (value === 'credits' || value === 'crystals') return value;
  throw new Error('UNSUPPORTED_AUCTION_CURRENCY');
}

/** A system seller is valid only when the lot is explicitly marked as a system lot. */
export function isSystemAuctionSeller(sellerId: unknown, isSystem: unknown): boolean {
  return sellerId === 'system' && isSystem === true;
}

export function normalizeAuctionBalance(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

/** Resolve the authoritative auction price without silently flooring corrupt values. */
export function resolveAuctionPrice(currentBid: unknown, startingPrice: unknown, price: unknown): number {
  const isAbsent = (value: unknown) => value === undefined || value === null || value === '' || value === 0;
  const raw = !isAbsent(currentBid) ? currentBid : !isAbsent(startingPrice) ? startingPrice : price;
  if (isAbsent(raw)) return 0;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new Error('AUCTION_PRICE_INVALID');
  }
  if (typeof raw === 'string' && raw.trim() === '') {
    throw new Error('AUCTION_PRICE_INVALID');
  }
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('AUCTION_PRICE_INVALID');
  }
  return amount;
}

function resolveRecordedEscrowAmount(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('AUCTION_ESCROW_AMOUNT_INVALID');
  }
  return amount;
}

export function resolveAuctionEscrow({
  currency,
  escrowCurrency,
  escrowedAmount,
  price,
  bidderId,
  buyerExists,
}: {
  currency: string;
  escrowCurrency: unknown;
  escrowedAmount: unknown;
  price: number;
  bidderId: string;
  buyerExists: boolean;
}) {
  const amount = resolveRecordedEscrowAmount(escrowedAmount);
  if (amount <= 0) {
    return { amount: 0, hasRecordedEscrow: false, hasValidEscrow: false };
  }
  if (escrowCurrency !== currency) {
    throw new Error('AUCTION_ESCROW_CURRENCY_MISMATCH');
  }
  if (!bidderId || !buyerExists) {
    throw new Error('AUCTION_ESCROW_BIDDER_UNAVAILABLE');
  }
  if (!Number.isSafeInteger(price) || price <= 0 || amount !== price) {
    throw new Error('AUCTION_ESCROW_AMOUNT_MISMATCH');
  }
  return {
    amount,
    hasRecordedEscrow: true,
    hasValidEscrow: true,
  };
}

/** Validate the escrow already attached to a lot before accepting another bid. */
export function resolvePreviousAuctionBidEscrow({
  currency,
  escrowCurrency,
  escrowedAmount,
  currentBid,
  previousBidderId,
}: {
  currency: string;
  escrowCurrency: unknown;
  escrowedAmount: unknown;
  currentBid: number;
  previousBidderId: string;
}) {
  const amount = resolveRecordedEscrowAmount(escrowedAmount);
  if (amount <= 0) return 0;
  if (escrowCurrency !== currency) {
    throw new Error('AUCTION_ESCROW_CURRENCY_MISMATCH');
  }
  if (!previousBidderId) {
    throw new Error('AUCTION_ESCROW_BIDDER_UNAVAILABLE');
  }
  if (!Number.isSafeInteger(currentBid) || currentBid <= 0 || amount !== currentBid) {
    throw new Error('AUCTION_ESCROW_AMOUNT_MISMATCH');
  }
  return amount;
}

/**
 * Daily system-lot rotation may remove only lots that have never reserved
 * bidder funds. Any bidder or escrow record must remain for normal settlement.
 */
export function canPruneUnbidSystemAuctionLot(lot: any): boolean {
  if (!lot || typeof lot !== 'object') return false;
  if (String(lot.highestBidderId || lot.highestBidderUid || '').trim()) return false;
  const rawEscrow = lot.escrowedAmount;
  if (rawEscrow === undefined || rawEscrow === null || rawEscrow === 0 || rawEscrow === '0' || rawEscrow === '') {
    return true;
  }
  const amount = Number(rawEscrow);
  return Number.isSafeInteger(amount) && amount === 0;
}
