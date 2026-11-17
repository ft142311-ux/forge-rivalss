import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  for (const value of [undefined, null, '', 'not-a-date', 0, -1, NaN, Infinity, {}, { toMillis: () => { throw new Error('bad timestamp'); } }]) {
    assert.equal(resolveMarketBidExpiryMs(value), null);
  }
});

test('standard market price accepts only non-negative safe integer values', () => {
  assert.equal(resolveMarketBidPrice(500, 100), 500);
  assert.equal(resolveMarketBidPrice(undefined, 100), 100);
  assert.equal(resolveMarketBidPrice(null, 100), 100);
  for (const value of [-1, 1.5, 'corrupt', '', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, false]) {
    assert.equal(resolveMarketBidPrice(value, 100), null);
  }
});

test('standard market bid action fails closed before writing when expiry or price is invalid', () => {
  const source = readFileSync(new URL('../src/app/actions/gameplay.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function placePlayerBidAction');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start);
  const action = source.slice(start, end);
  assert.ok(action.includes("typeof bid !== 'number'"));
  assert.ok(action.includes('Number.isSafeInteger(bid)'));
  assert.ok(action.includes('resolveMarketBidExpiryMs(lot.expiresAt)'));
  assert.ok(action.includes("if (expiresAt === null) throw new Error('MARKET_EXPIRY_INVALID')"));
  assert.ok(action.includes('resolveMarketBidPrice(lot.currentBid, lot.startingPrice)'));
  assert.ok(action.includes("if (currentBid === null) throw new Error('MARKET_PRICE_INVALID')"));
  assert.ok(action.indexOf('MARKET_EXPIRY_INVALID') < action.indexOf('t.update(marketRef'));
  assert.ok(action.indexOf('MARKET_PRICE_INVALID') < action.indexOf('t.update(marketRef'));
});
