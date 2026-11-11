import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSystemAuctionSeller,
  normalizeAuctionBalance,
  resolveAuctionCurrency,
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
