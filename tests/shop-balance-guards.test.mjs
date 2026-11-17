import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');

test('shop balance reader rejects non-integer, negative and unsafe currency balances', () => {
  assert.match(source, /function readCurrencyBalance\(value: unknown\)/);
  assert.match(source, /!Number\.isSafeInteger\(balance\) \|\| balance < 0/);
  assert.doesNotMatch(source, /Number\(data\.(?:credits|crystals)\s*\|\|\s*0\)/);
});

test('crystal-to-credit exchange validates both balances and resulting credit total', () => {
  const start = source.indexOf('export async function exchangeCrystalsForCreditsAction');
  const end = source.indexOf('export async function changeClubNameAction', start);
  const action = source.slice(start, end);
  assert.match(action, /readCurrencyBalance\(data\.crystals\)/);
  assert.match(action, /readCurrencyBalance\(data\.credits\)/);
  assert.match(action, /!Number\.isSafeInteger\(creditsAfter\)/);
  assert.ok(action.indexOf('readCurrencyBalance(data.crystals)') < action.indexOf('t.update(ref'));
});

test('emulator diamond-pack crediting rejects an overflowing resulting balance', () => {
  const start = source.indexOf('export async function purchaseDiamondPackAction');
  const end = source.indexOf('export async function exchangeCrystalsForCreditsAction', start);
  const action = source.slice(start, end);
  assert.match(action, /const before = readCurrencyBalance\(data\.crystals\)/);
  assert.match(action, /if \(!Number\.isSafeInteger\(after\)\) throw new Error\('INVALID_BALANCE'\)/);
});
