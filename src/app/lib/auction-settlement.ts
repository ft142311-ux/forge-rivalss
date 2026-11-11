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
