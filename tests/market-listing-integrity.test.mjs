import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMarketListingPrice,
  resolveYouthMarketStartingPrice,
} from '../src/app/lib/market-listing.ts';

test('standard market listing accepts only positive safe integer opening prices', () => {
  assert.equal(resolveMarketListingPrice(40000), 40000);
  for (const value of [0, -1, 1.5, '40000', '', NaN, Infinity, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveMarketListingPrice(value), /MARKET_PRICE_INVALID/);
  }
});

test('youth market opening price is deterministic and bounded by a valid overall rating', () => {
  assert.equal(resolveYouthMarketStartingPrice(undefined), 25000);
  assert.equal(resolveYouthMarketStartingPrice(0), 25000);
  assert.equal(resolveYouthMarketStartingPrice('60'), 325000);
  assert.equal(resolveYouthMarketStartingPrice(100), 525000);
  for (const value of [-1, 100.01, ' ', 'corrupt', NaN, Infinity, true, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => resolveYouthMarketStartingPrice(value), /MARKET_PRICE_INVALID/);
  }
});
