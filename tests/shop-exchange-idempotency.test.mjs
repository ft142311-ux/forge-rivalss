import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/shop/page.tsx', import.meta.url), 'utf8');

test('exchange uses a persisted operation receipt inside the balance transaction', () => {
  assert.match(action, /shop_operation_receipts/);
  assert.match(action, /const receiptSnap = await t\.get\(receiptRef\);[\s\S]*if \(receiptSnap\.exists\) return receiptSnap\.data\(\)\?\.result;/);
  assert.match(action, /t\.create\(receiptRef,[\s\S]*operation: 'CRYSTAL_TO_CREDITS'/);
});

test('client reuses an exchange operation id after an ambiguous network failure', () => {
  assert.match(page, /getPendingExchangeOperationId/);
  assert.match(page, /localStorage\.setItem\(key, operationId\)/);
  assert.match(page, /exchangeCrystalsForCreditsAction\(await getToken\(\), amount, operationId\)/);
  assert.match(page, /clearPendingExchangeOperationId\(user\?\.uid \|\| 'unknown', amount\)/);
});
