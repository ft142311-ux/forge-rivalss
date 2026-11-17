import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isSystemAuctionSeller,
  normalizeAuctionBalance,
  resolveAuctionCurrency,
  resolveAuctionEscrow,
  resolvePreviousAuctionBidEscrow,
  resolveAuctionPrice,
  resolveAuctionMaxBid,
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

test('auction balances accept only non-negative safe integers and reject corrupt values', () => {
  assert.equal(normalizeAuctionBalance('12'), 12);
  assert.equal(normalizeAuctionBalance(12), 12);
  assert.equal(normalizeAuctionBalance(undefined), 0);
  assert.equal(normalizeAuctionBalance(null), 0);
  for (const value of ['12.9', -5, 'invalid', true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeAuctionBalance(value), /AUCTION_BALANCE_INVALID/);
  }
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
  for (const escrowedAmount of ['corrupt', -1, 1.5, true, false, '   ', Number.MAX_SAFE_INTEGER + 1]) {
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

test('auction max bid rejects malformed and fractional configured limits without rounding', () => {
  assert.equal(resolveAuctionMaxBid(undefined, 1200), 1200);
  assert.equal(resolveAuctionMaxBid(0, 1200), 1200);
  assert.equal(resolveAuctionMaxBid('1500', 1200), 1500);
  for (const value of [true, false, 1.5, '1.5', '   ', 'invalid', -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveAuctionMaxBid(value, 1200), /MARKET_BID_LIMITS_INVALID/);
  }
});

test('daily system-lot rotation prunes only lots with no bidder and no escrow', () => {
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderId: null, escrowedAmount: 0 }), true);
  assert.equal(canPruneUnbidSystemAuctionLot({}), true);
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderId: 'manager-1', escrowedAmount: 0 }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderUid: 'manager-1' }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ escrowedAmount: 500 }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ escrowedAmount: 'corrupt' }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ escrowedAmount: false }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ escrowedAmount: true }), false);
});

test('standard bids and shared PRO/youth bid handler use strict configured max-bid validation', async () => {
  const source = readFileSync(new URL('../src/app/lib/auction-bid.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/resolveAuctionMaxBid\(/g) || []).length, 3);
});
