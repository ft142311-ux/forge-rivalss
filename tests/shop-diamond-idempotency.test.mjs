import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/shop/page.tsx', import.meta.url), 'utf8');

test('diamond order and emulator grant are protected by a per-user operation receipt', () => {
  assert.match(action, /shop_operation_receipts/);
  assert.match(action, /uid\}_diamond_\$\{normalizedOperationId/);
  assert.match(action, /operation: 'DIAMOND_PACK_ORDER'/);
  assert.match(action, /operation: 'DIAMOND_PACK_TEST_PURCHASE'/);
});

test('client reuses a diamond operation id after an ambiguous network failure', () => {
  assert.match(page, /getPendingDiamondOperationId/);
  assert.match(page, /purchaseDiamondPackAction\(await getToken\(\), amount, operationId\)/);
  assert.match(page, /clearPendingDiamondOperationId\(user\?\.uid \|\| 'unknown', amount\)/);
});
