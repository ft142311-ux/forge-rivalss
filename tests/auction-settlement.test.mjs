import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSystemAuctionSeller,
  normalizeAuctionBalance,
  resolveAuctionCurrency,
  resolveAuctionEscrow,
  resolvePreviousAuctionBidEscrow,
  resolveAuctionPrice,
  canPruneUnbidSystemAuctionLot,
} from '../src/app/lib/auction-settlement.ts';

test('legacy auction lots default to credits', () => {
  assert.equal(resolveAuctionCurrency(undefined), 'credits');
  assert.equal(resolveAuctionCurrency(null), 'credits');
  assert.equal(resolveAuctionCurrency(''), 'credits');
});

test('auction currency preserves explicit credits and crystals', () => {
  assert.equal(resolveAuctionCurrency('credits'), 'credits');
  assert.equal(resolveAuctionCurrency('crystals'), 'crystals');
});

test('unknown auction currencies fail closed', () => {
  assert.throws(() => resolveAuctionCurrency('diamonds'), /UNSUPPORTED_AUCTION_CURRENCY/);
});

test('system seller requires both the reserved seller id and system marker', () => {
  assert.equal(isSystemAuctionSeller('system', true), true);
  assert.equal(isSystemAuctionSeller('system', false), false);
  assert.equal(isSystemAuctionSeller('manager-1', true), false);
});

test('auction balances are normalized to non-negative integer amounts', () => {
  assert.equal(normalizeAuctionBalance('12.9'), 12);
  assert.equal(normalizeAuctionBalance(-5), 0);
  assert.equal(normalizeAuctionBalance('invalid'), 0);
});

test('auction price accepts valid integer values and rejects malformed recorded prices', () => {
  assert.equal(resolveAuctionPrice(750, 500, 400), 750);
  assert.equal(resolveAuctionPrice(0, 500, 400), 500);
  assert.equal(resolveAuctionPrice(undefined, undefined, '250'), 250);
  for (const value of [-1, 1.5, 'corrupt', '   ', NaN, false, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveAuctionPrice(value, 500, 400), /AUCTION_PRICE_INVALID/);
  }
});

test('auction escrow requires an exact amount and matching currency', () => {
  assert.deepEqual(resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: 'credits', escrowedAmount: 500,
    price: 500, bidderId: 'buyer-1', buyerExists: true,
  }), { amount: 500, hasRecordedEscrow: true, hasValidEscrow: true });
  assert.throws(() => resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: 'crystals', escrowedAmount: 500,
    price: 500, bidderId: 'buyer-1', buyerExists: true,
  }), /AUCTION_ESCROW_CURRENCY_MISMATCH/);
  assert.throws(() => resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: 'credits', escrowedAmount: 400,
    price: 500, bidderId: 'buyer-1', buyerExists: true,
  }), /AUCTION_ESCROW_AMOUNT_MISMATCH/);
  assert.throws(() => resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: 'credits', escrowedAmount: 600,
    price: 500, bidderId: 'buyer-1', buyerExists: true,
  }), /AUCTION_ESCROW_AMOUNT_MISMATCH/);
});

test('malformed recorded escrow fails closed instead of being treated as an empty legacy escrow', () => {
  for (const escrowedAmount of ['corrupt', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveAuctionEscrow({
      currency: 'credits', escrowCurrency: 'credits', escrowedAmount,
      price: 500, bidderId: 'buyer-1', buyerExists: true,
    }), /AUCTION_ESCROW_AMOUNT_INVALID/);
  }
});

test('auction escrow cannot be discarded when the winning bidder is unavailable', () => {
  assert.throws(() => resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: 'credits', escrowedAmount: 500,
    price: 500, bidderId: 'buyer-1', buyerExists: false,
  }), /AUCTION_ESCROW_BIDDER_UNAVAILABLE/);
  assert.throws(() => resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: 'credits', escrowedAmount: 500,
    price: 500, bidderId: '', buyerExists: true,
  }), /AUCTION_ESCROW_BIDDER_UNAVAILABLE/);
});

test('legacy auctions without recorded escrow keep the fallback settlement path', () => {
  assert.deepEqual(resolveAuctionEscrow({
    currency: 'credits', escrowCurrency: undefined, escrowedAmount: 0,
    price: 500, bidderId: 'buyer-1', buyerExists: true,
  }), { amount: 0, hasRecordedEscrow: false, hasValidEscrow: false });
});



test('new bids reject mismatched, incomplete, or unowned previous escrow', () => {
  assert.equal(resolvePreviousAuctionBidEscrow({
    currency: 'crystals', escrowCurrency: 'crystals', escrowedAmount: 500,
    currentBid: 500, previousBidderId: 'manager-1',
  }), 500);
  assert.throws(() => resolvePreviousAuctionBidEscrow({
    currency: 'crystals', escrowCurrency: 'credits', escrowedAmount: 500,
    currentBid: 500, previousBidderId: 'manager-1',
  }), /AUCTION_ESCROW_CURRENCY_MISMATCH/);
  assert.throws(() => resolvePreviousAuctionBidEscrow({
    currency: 'crystals', escrowCurrency: 'crystals', escrowedAmount: 400,
    currentBid: 500, previousBidderId: 'manager-1',
  }), /AUCTION_ESCROW_AMOUNT_MISMATCH/);
  assert.throws(() => resolvePreviousAuctionBidEscrow({
    currency: 'crystals', escrowCurrency: 'crystals', escrowedAmount: 500,
    currentBid: 500, previousBidderId: '',
  }), /AUCTION_ESCROW_BIDDER_UNAVAILABLE/);
  assert.throws(() => resolvePreviousAuctionBidEscrow({
    currency: 'crystals', escrowCurrency: 'crystals', escrowedAmount: 'corrupt',
    currentBid: 500, previousBidderId: 'manager-1',
  }), /AUCTION_ESCROW_AMOUNT_INVALID/);
});

test('daily system-lot rotation prunes only lots with no bidder and no escrow', () => {
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderId: null, escrowedAmount: 0 }), true);
  assert.equal(canPruneUnbidSystemAuctionLot({}), true);
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderId: 'manager-1', escrowedAmount: 0 }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderUid: 'manager-1' }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ escrowedAmount: 500 }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ escrowedAmount: 'corrupt' }), false);
});
