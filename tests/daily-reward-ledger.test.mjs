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


test('daily reward action returns claim date and reward day for immediate client synchronization', () => {
  const start = action.indexOf('export async function claimDailyRewardAction');
  const end = action.indexOf('export async function purchasePremiumAction');
  const claim = action.slice(start, end);
  assert.match(claim, /claimedDate: today/);
  assert.match(claim, /alreadyClaimed: true/);
  assert.match(claim, /alreadyClaimed: false, rewardDay, claimedDate: today/);
});

test('client reward claim immediately synchronizes local claim date to prevent reopening the modal', () => {
  const store = readFileSync(new URL('../src/app/lib/store.tsx', import.meta.url), 'utf8');
  const start = store.indexOf('const claimReward = useCallback');
  const end = store.indexOf('const purchasePremium = useCallback', start);
  const claim = store.slice(start, end);
  assert.match(claim, /saveToLocal\(\{[\s\S]*lastRewardClaimDate: res\.claimedDate \|\| getMoscowDateString\(\),[\s\S]*rewardDay:/);
  assert.match(claim, /managerLevel: Number\(managerXp\.managerLevel\)/);
  assert.match(claim, /experiencePoints: Number\(managerXp\.experiencePoints\)/);
  assert.match(claim, /res\.alreadyClaimed/);
});
