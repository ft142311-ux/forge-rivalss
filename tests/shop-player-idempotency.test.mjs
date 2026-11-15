import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/shop/page.tsx', import.meta.url), 'utf8');

test('shop player creation validates a caller-owned operation id and reads its receipt first', () => {
  const start = action.indexOf('export async function createShopPlayerAction');
  assert.notEqual(start, -1);
  const createAction = action.slice(start);
  assert.match(createAction, /operationId:\s*string/);
  assert.match(createAction, /normalizedOperationId/);
  assert.match(createAction, /shop_operation_receipts/);
  assert.match(createAction, /const receiptSnap = await t\.get\(receiptRef\)/);
  assert.ok(createAction.indexOf('t.get(receiptRef)') < createAction.indexOf("t.get(ref)"));
});

test('replayed player creation validates the original request and returns its stored result', () => {
  const start = action.indexOf('export async function createShopPlayerAction');
  const createAction = action.slice(start);
  for (const field of ['userId', 'operation', 'nickname', 'role', 'talent', 'age', 'country?.code', 'country?.name', 'country?.flag']) {
    assert.ok(createAction.includes(`receipt.${field}`), `receipt must validate ${field}`);
  }
  assert.match(createAction, /throw new Error\('IDEMPOTENCY_KEY_REUSED'\)/);
  assert.match(createAction, /return \{ \.\.\.\(receipt\.result \|\| \{\}\), duplicate: true \}/);
  assert.match(createAction, /t\.create\(receiptRef,[\s\S]*operation: 'SHOP_PLAYER_CREATION'[\s\S]*result,[\s\S]*createdAt/);
  assert.match(createAction, /t\.update\(ref,[\s\S]*crystals: crystals - creationCost/);
  assert.match(createAction, /t\.set\(tx,[\s\S]*type: 'SHOP_PLAYER_CREATION'/);
});

test('shop client persists the same creation operation across an ambiguous request failure', () => {
  assert.match(page, /getPendingPlayerCreationOperationId/);
  assert.match(page, /localStorage\.setItem\(key, operationId\)/);
  assert.match(page, /createShopPlayerAction\(await getToken\(\),[\s\S]*operationId\)/);
  assert.match(page, /clearPendingPlayerCreationOperationId\(userId, fingerprint\)/);
  const handlerStart = page.indexOf('const handleCreatePlayer');
  const handlerEnd = page.indexOf('const handleBuyDiamonds', handlerStart);
  const handler = page.slice(handlerStart, handlerEnd);
  assert.ok(handler.indexOf('if (!res.success)') < handler.indexOf('clearPendingPlayerCreationOperationId(userId, fingerprint)'));
  assert.match(handler, /catch \(e: any\) \{\s*toast/);
  assert.doesNotMatch(handler.slice(handler.indexOf('catch (e: any)'), handler.indexOf('finally')), /clearPendingPlayerCreationOperationId/);
});


test('license purchase retry cannot debit twice because the tier transition is sequential', () => {
  const start = action.indexOf('export async function purchaseLicenseAction');
  const end = action.indexOf('export async function purchasePremiumShopAction', start);
  const license = action.slice(start, end);
  assert.match(license, /tier !== current - 1/);
  assert.match(license, /crystals: crystals - cost,[\s\S]*activeLicenseTier: tier/);
  assert.match(license, /t\.set\(tx,[\s\S]*type: 'LICENSE_PURCHASE'/);
  assert.ok(license.indexOf('tier !== current - 1') < license.indexOf('crystals: crystals - cost'));
});

test('premium purchase retry is rejected while the first purchase remains active', () => {
  const start = action.indexOf('export async function purchasePremiumShopAction');
  const end = action.indexOf('export async function purchaseDiamondPackAction', start);
  const premium = action.slice(start, end);
  assert.match(premium, /data\.isPremium === true && currentUntil > now/);
  assert.match(premium, /throw new Error\('PREMIUM_ALREADY_ACTIVE'\)/);
  assert.match(premium, /crystals: crystals - cost,[\s\S]*isPremium: true,[\s\S]*premiumUntil/);
  assert.match(premium, /t\.set\(tx,[\s\S]*type: 'PREMIUM_PURCHASE'/);
  assert.ok(premium.indexOf('PREMIUM_ALREADY_ACTIVE') < premium.indexOf('crystals: crystals - cost'));
});
