import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const expirySweepSource = readFileSync(new URL('../src/app/lib/auction-expiry-sweep.ts', import.meta.url), 'utf8');
import {
  resolveMarketBidExpiryMs,
  resolveMarketBidPrice,
} from '../src/app/lib/market-bid-guards.ts';

test('standard market expiry accepts supported finite timestamp representations', () => {
  const expiry = 2_000_000;
  assert.equal(resolveMarketBidExpiryMs(expiry), expiry);
  assert.equal(resolveMarketBidExpiryMs(new Date(expiry)), expiry);
  assert.equal(resolveMarketBidExpiryMs(new Date(expiry).toISOString()), expiry);
  assert.equal(resolveMarketBidExpiryMs({ toMillis: () => expiry }), expiry);
  assert.equal(resolveMarketBidExpiryMs({ toDate: () => new Date(expiry) }), expiry);
});

test('standard market expiry rejects missing, malformed, non-finite and throwing timestamps', () => {
  for (const value of [undefined, null, '', 'not-a-date', 0, -1, NaN, Infinity, {}, { toMillis: () => { throw new Error('bad timestamp'); } }, { toDate: () => { throw new Error('bad date'); } }]) {
    assert.equal(resolveMarketBidExpiryMs(value), null);
  }
});

test('special and standard auction bids share strict expiry timestamp normalization', () => {
  const source = readFileSync(new URL('../src/app/lib/auction-bid.ts', import.meta.url), 'utf8');
  const specialStart = source.indexOf('export async function placeSpecialMarketBidWithDb');
  const standardStart = source.indexOf('export async function placeStandardMarketBidWithDb');
  assert.ok(specialStart >= 0 && standardStart > specialStart);
  const specialAction = source.slice(specialStart, standardStart);
  const standardAction = source.slice(standardStart);
  assert.match(specialAction, /resolveMarketBidExpiryMs\(lot\.expiresAt\)/);
  assert.match(standardAction, /resolveMarketBidExpiryMs\(lot\.expiresAt\)/);
  assert.match(specialAction, /MARKET_EXPIRY_INVALID/);
});

test('market expiry sweep shares bid timestamp normalization and a consistent clock', () => {
  const settleStart = expirySweepSource.indexOf('async function settleCandidate');
  const sweepStart = expirySweepSource.indexOf('export async function runTransferMarketExpirySweepWithDb');
  assert.ok(settleStart >= 0 && sweepStart > settleStart);
  const settleBlock = expirySweepSource.slice(settleStart, sweepStart);
  const scanStart = expirySweepSource.indexOf('for (const doc of page.docs)');
  const scanEnd = expirySweepSource.indexOf('dueCount += pageDue.length', scanStart);
  assert.ok(scanStart >= 0 && scanEnd > scanStart);
  const scanBlock = expirySweepSource.slice(scanStart, scanEnd);

  assert.match(settleBlock, /resolveMarketBidExpiryMs\(lot\.expiresAt\)/);
  assert.match(settleBlock, /expiryMs > nowMs/);
  assert.match(scanBlock, /resolveMarketBidExpiryMs\(lot\.expiresAt\)/);
  assert.match(scanBlock, /expiresAt <= now\(\)/);
  assert.match(expirySweepSource, /settleCandidate\(candidate, db, now\(\)\)/);
});

test('standard market price accepts only non-negative safe integer values', () => {
  assert.equal(resolveMarketBidPrice(500, 100), 500);
  assert.equal(resolveMarketBidPrice(undefined, 100), 100);
  assert.equal(resolveMarketBidPrice(null, 100), 100);
  assert.equal(resolveMarketBidPrice(0, 100), 100, 'zero current bid must not bypass the opening price');
  for (const value of [-1, 1.5, 'corrupt', '', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, false]) {
    assert.equal(resolveMarketBidPrice(value, 100), null);
  }
});

test('standard player listings are discoverable by the quick-search market query', () => {
  const source = readFileSync(new URL('../src/app/lib/market-listing.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function createStandardMarketListingWithDb');
  const end = source.indexOf('export async function createYouthMarketListingWithDb', start);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.slice(start, end).includes("marketType: 'player'"));
});

test('standard market bids are indexed by UID for the My Bids array-contains query', () => {
  const action = readFileSync(new URL('../src/app/actions/gameplay.ts', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../src/app/lib/auction-bid.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/app/transfers/my-bids/page.tsx', import.meta.url), 'utf8');
  const start = helper.indexOf('export async function placeStandardMarketBidWithDb');
  const end = helper.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  const block = helper.slice(start, end);
  assert.ok(action.includes('placeStandardMarketBidWithDb(getAdminDb(), userId, marketId, amount)'));
  assert.ok(block.includes('const bidderId = normalizeAuctionUserId(uid)'));
  assert.ok(block.includes('bidders.push(bidderId)'));
  assert.ok(!block.includes('bidders.push({'));
  assert.ok(page.includes("where('bidders', 'array-contains', user.uid)"));
});

test('standard market bid action fails closed before writing when expiry or price is invalid', () => {
  const source = readFileSync(new URL('../src/app/lib/auction-bid.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function placeStandardMarketBidWithDb');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  const action = source.slice(start, end);
  assert.ok(action.includes("typeof amount !== 'number'"));
  assert.ok(action.includes('Number.isSafeInteger(amount)'));
  assert.ok(action.includes('resolveMarketBidExpiryMs(lot.expiresAt)'));
  assert.ok(action.includes("if (expiresAt === null) throw new Error('MARKET_EXPIRY_INVALID')"));
  assert.ok(action.includes('resolveMarketBidPrice(lot.currentBid, lot.startingPrice)'));
  assert.ok(action.includes("if (currentBid === null) throw new Error('MARKET_PRICE_INVALID')"));
  assert.ok(action.indexOf('MARKET_EXPIRY_INVALID') < action.indexOf('tx.update(marketRef'));
  assert.ok(action.indexOf('MARKET_PRICE_INVALID') < action.indexOf('tx.update(marketRef'));
  assert.ok(action.includes("lot.isPro === true || lot.isYouth === true"));
  assert.ok(action.includes("resolveAuctionCurrency(lot.currency)"));
  assert.ok(action.includes("resolvePreviousAuctionBidEscrow({"));
  assert.ok(action.includes("bidderBalance < chargeAmount"));
  assert.ok(action.includes("const minimumBid = Math.ceil(currentBid * 1.03)"));
  assert.ok(action.includes("if (amount > maxBid) throw new Error('BID_TOO_HIGH')"));
  assert.ok(action.includes("escrowedAmount: amount"));
  assert.ok(action.includes("escrowCurrency: currency"));
  assert.ok(action.includes("SPECIAL_AUCTION_BID_ESCROW"));
  assert.ok(action.includes("SPECIAL_AUCTION_OUTBID_REFUND"));
  assert.ok(action.includes("const nextExpiry = expiresAt - now < 10 * 60 * 1000"));
});


test('standard transfer bids verify that the seller still owns the uniquely listed player', () => {
  const helper = readFileSync(new URL('../src/app/lib/auction-bid.ts', import.meta.url), 'utf8');
  assert.match(helper, /async function assertStandardMarketSellerListing/);
  assert.match(helper, /const sellerSnap = await tx\.get\(sellerRef\)/);
  assert.match(helper, /matches\.length !== 1/);
  assert.match(helper, /lockId !== marketId/);
  assert.match(helper, /MARKET_LOT_STALE/);
  assert.match(helper, /await assertStandardMarketSellerListing\(tx, db, lot, marketId, now\)/);
});
