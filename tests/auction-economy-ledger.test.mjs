import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const market = readFileSync(new URL('../src/app/actions/pro-market.ts', import.meta.url), 'utf8');
const cycle = readFileSync(new URL('../src/app/actions/autonomous-cycle.ts', import.meta.url), 'utf8');
const expirySweep = readFileSync(new URL('../src/app/lib/auction-expiry-sweep.ts', import.meta.url), 'utf8');
const proMarket = readFileSync(new URL('../src/app/actions/pro-market.ts', import.meta.url), 'utf8');
const bidCore = readFileSync(new URL('../src/app/lib/auction-bid.ts', import.meta.url), 'utf8');

test('PRO and Youth auction bid ceilings are enforced by the server to match their interfaces', () => {
  assert.match(bidCore, /const minimumBid = Math\.ceil\(currentBid \* 1\.03\)/);
  assert.match(bidCore, /marketKind === 'youth' \? currentBid \* 4 : Number\(lot\.startingPrice \|\| currentBid\) \* 3/);
  assert.match(bidCore, /if \(bid < minimumBid\) throw new Error\('BID_TOO_LOW'\)/);
  assert.match(bidCore, /if \(bid > maxBid\) throw new Error\('BID_TOO_HIGH'\)/);
  assert.match(bidCore, /typeof amount !== 'number'/);
  assert.match(bidCore, /typeof marketId !== 'string'/);
});

test('special auction bid and outbid refund ledger entries include exact before and after balances', () => {
  const block = bidCore;
  assert.match(block, /balanceBefore: bidderBalance,[\s\S]*balanceAfter: bidderBalance - chargeAmount/);
  assert.match(block, /const previousBalance = money\(previousBidder\[currency\]\);[\s\S]*const refundedBalance = previousBalance \+ refundAmount;/);
  assert.match(block, /balanceBefore: previousBalance,[\s\S]*balanceAfter: refundedBalance/);
});

test('auction settlement records fallback debit, seller proceeds and escrow refund with balances', () => {
  const start = expirySweep.indexOf('export async function runTransferMarketExpirySweepWithDb');
  const block = expirySweep.slice(start);
  assert.match(block, /SPECIAL_AUCTION_SETTLEMENT_DEBIT[\s\S]*balanceBefore: buyerBalance,[\s\S]*balanceAfter: buyerBalance - price/);
  assert.match(block, /SPECIAL_AUCTION_SETTLEMENT_CREDIT[\s\S]*balanceBefore: sellerBefore,[\s\S]*balanceAfter: sellerAfter/);
  assert.match(block, /SPECIAL_AUCTION_SETTLEMENT_REFUND[\s\S]*balanceBefore: buyerBalance,[\s\S]*balanceAfter: refundedBalance/);
  assert.match(block, /auction_settlement_\$\{candidate\.id\}_seller/);
  assert.match(block, /auction_settlement_\$\{candidate\.id\}_refund/);
});

test('expired auction settlement uses strict price validation before any transaction writes', () => {
  assert.match(expirySweep, /resolveAuctionPrice\(lot\.currentBid, lot\.startingPrice, lot\.price\)/);
  assert.match(cycle, /import \{ runTransferMarketExpirySweepWithDb \} from '\@\/app\/lib\/auction-expiry-sweep'/);
});

test('ambiguous auction escrow is rejected before the expired lot can be deleted', () => {
  const start = expirySweep.indexOf('export async function runTransferMarketExpirySweepWithDb');
  const block = expirySweep.slice(start);
  const escrowGuard = block.indexOf('resolveAuctionEscrow({');
  const firstLotDelete = block.indexOf('tx.delete(lotRef)');
  assert.ok(escrowGuard >= 0, 'settlement must validate recorded escrow');
  assert.ok(firstLotDelete > escrowGuard, 'lot deletion must follow escrow validation');
  assert.match(block, /if \(hasRecordedEscrow && buyerRef && buyerSnap\?\.exists\)/);
});


test('daily PRO rotation preserves system lots with a bidder or escrow for shared settlement', () => {
  const start = proMarket.indexOf('export async function ensureProMarketDailyDropAction');
  const end = proMarket.indexOf('/** Places a bid on a special auction', start);
  const block = proMarket.slice(start, end);
  assert.match(block, /canPruneUnbidSystemAuctionLot\(oldLot\.data\(\) \|\| \{\}\)/);
  assert.match(block, /retainedWithBids\+\+/);
  assert.match(block, /tx\.delete\(oldLot\.ref\)/);
  assert.doesNotMatch(block, /for \(const oldLot of systemLots\.docs\) \{\s*if \(oldLot\.id !== lotId\) tx\.delete/);
});

test('new special-market bids validate existing escrow before charging or replacing it', () => {
  const block = bidCore;
  const guard = block.indexOf('resolvePreviousAuctionBidEscrow({');
  const charge = block.indexOf('const chargeAmount =');
  assert.ok(guard >= 0 && charge > guard);
  assert.match(block, /highestBidderId \|\| lot\.highestBidderUid/);
  assert.match(block, /resolveAuctionPrice\(lot\.currentBid, lot\.startingPrice, 0\)/);
});
