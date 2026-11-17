import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = new URL('../src/app/actions/', import.meta.url);
const cycle = readFileSync(new URL('foundation-cycle.ts', app), 'utf8');
const p2 = readFileSync(new URL('p2-management.ts', app), 'utf8');
const shop = readFileSync(new URL('shop.ts', app), 'utf8');

test('foundation daily salary ledger records the manager balance transition', () => {
  assert.match(cycle, /type: 'DAILY_SALARY',[\s\S]*balanceBefore: before,[\s\S]*balanceAfter: before - paid/);
});

test('legacy transfer-market purchase records buyer debit and seller proceeds', () => {
  assert.match(p2, /market_\$\{marketId\}_buyer/);
  assert.match(p2, /type: 'TRANSFER_MARKET_PURCHASE',[\s\S]*balanceBefore: balance,[\s\S]*balanceAfter: buyerAfter/);
  assert.match(p2, /market_\$\{marketId\}_seller/);
  assert.match(p2, /type: 'TRANSFER_MARKET_SALE',[\s\S]*balanceBefore: sellerBefore,[\s\S]*balanceAfter: sellerAfter/);
});

test('legacy scouting, staff hiring and player care debits have ledger balances', () => {
  assert.match(p2, /type:'YOUTH_SCOUTING',[\s\S]*balanceBefore:before,balanceAfter:after/);
  assert.match(p2, /type:'STAFF_HIRE',[\s\S]*balanceBefore:before,balanceAfter:after/);
  assert.match(p2, /type: 'PLAYER_CARE_PURCHASE',[\s\S]*balanceBefore,[\s\S]*balanceAfter/);
});

test('shop player creation records crystal balance transition', () => {
  assert.match(shop, /type: 'SHOP_PLAYER_CREATION',[\s\S]*balanceBefore: crystals,[\s\S]*balanceAfter: crystals - creationCost/);
});
