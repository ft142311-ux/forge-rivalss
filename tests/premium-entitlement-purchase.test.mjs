import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/economy.ts', import.meta.url), 'utf8');

test('legacy premium purchase activates the entitlement in the same transaction as the debit', () => {
  const start = action.indexOf('export async function purchasePremiumAction');
  assert.notEqual(start, -1);
  const purchase = action.slice(start);
  assert.match(purchase, /player\.isPremium === true && currentUntil > now/);
  assert.match(purchase, /crystals: crystals - cost,[\s\S]*isPremium: true,[\s\S]*premiumUntil,/);
  assert.match(purchase, /balanceBefore: crystals,[\s\S]*balanceAfter: crystals - cost/);
  assert.match(purchase, /db\.runTransaction/);
  assert.doesNotMatch(purchase, /applyTransaction/);
});
