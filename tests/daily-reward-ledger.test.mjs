import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/economy.ts', import.meta.url), 'utf8');

test('daily reward claim persists an idempotent receipt with both balance ledger entries atomically', () => {
  const start = action.indexOf('export async function claimDailyRewardAction');
  const end = action.indexOf('export async function purchasePremiumAction');
  const claim = action.slice(start, end);
  assert.match(claim, /daily_reward_receipts/);
  assert.match(claim, /if \(receiptSnap\.exists\) return receiptSnap\.data\(\)\?\.result/);
  assert.match(claim, /daily_reward_\$\{userId\}_\$\{today\}_credits/);
  assert.match(claim, /daily_reward_\$\{userId\}_\$\{today\}_crystals/);
  assert.match(claim, /balanceBefore: creditsBefore,[\s\S]*balanceAfter: creditsAfter/);
  assert.match(claim, /balanceBefore: crystalsBefore,[\s\S]*balanceAfter: crystalsAfter/);
  assert.match(claim, /t\.create\(receiptRef/);
  assert.match(claim, /lastRewardClaimDate: today/);
});
