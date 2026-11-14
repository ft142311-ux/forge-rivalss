import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');

test('shop player creation uses one collision-resistant id across generation and transaction retries', () => {
  assert.match(action, /import \{ randomUUID \} from 'node:crypto';/);
  assert.match(action, /const playerId = `shop_\$\{uid\}_\$\{randomUUID\(\)\}`;/);
  assert.match(action, /generateUniquePlayer\(parsedRole, owned\.length \+ youth\.length, false, playerId\)/);
  assert.match(action, /id: playerId,/);
  assert.doesNotMatch(action, /shop_\$\{uid\}_\$\{Date\.now\(\)\}/);
});
