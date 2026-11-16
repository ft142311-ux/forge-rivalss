import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const market = readFileSync(new URL('../src/app/actions/pro-market.ts', import.meta.url), 'utf8');
const cycle = readFileSync(new URL('../src/app/actions/autonomous-cycle.ts', import.meta.url), 'utf8');

test('special auction bid and outbid refund ledger entries include exact before and after balances', () => {
  const start = market.indexOf('async function placeSpecialMarketBid');
  const end = market.indexOf('export async function placeProMarketBidAction', start);
  const block = market.slice(start, end);
  assert.match(block, /balanceBefore: bidderBalance,[\s\S]*balanceAfter: bidderBalance - chargeAmount/);
  assert.match(block, /balanceBefore: money\(previousBidder\[currency\]\),[\s\S]*balanceAfter: money\(previousBidder\[currency\]\) \+ refundAmount/);
});

test('auction settlement records fallback debit, seller proceeds and escrow refund with balances', () => {
  const start = cycle.indexOf('export async function runTransferMarketExpirySweep');
  const end = cycle.indexOf('export async function runPlayerAuctionSettlementSweep', start);
  const block = cycle.slice(start, end);
  assert.match(block, /SPECIAL_AUCTION_SETTLEMENT_DEBIT[\s\S]*balanceBefore: buyerBalance,[\s\S]*balanceAfter: buyerBalance - price/);
  assert.match(block, /SPECIAL_AUCTION_SETTLEMENT_CREDIT[\s\S]*balanceBefore: sellerBefore,[\s\S]*balanceAfter: sellerAfter/);
  assert.match(block, /SPECIAL_AUCTION_SETTLEMENT_REFUND[\s\S]*balanceBefore: buyerBalance,[\s\S]*balanceAfter: refundedBalance/);
  assert.match(block, /auction_settlement_\$\{candidate\.id\}_seller/);
  assert.match(block, /auction_settlement_\$\{candidate\.id\}_refund/);
});

test('ambiguous auction escrow is rejected before the expired lot can be deleted', () => {
  const start = cycle.indexOf('export async function runTransferMarketExpirySweep');
  const end = cycle.indexOf('export async function runPlayerAuctionSettlementSweep', start);
  const block = cycle.slice(start, end);
  const escrowGuard = block.indexOf('resolveAuctionEscrow({');
  const firstLotDelete = block.indexOf('tx.delete(lotRef)');
  assert.ok(escrowGuard >= 0, 'settlement must validate recorded escrow');
  assert.ok(firstLotDelete > escrowGuard, 'lot deletion must follow escrow validation');
  assert.match(block, /if \(hasRecordedEscrow && buyerRef && buyerSnap\?\.exists\)/);
});
