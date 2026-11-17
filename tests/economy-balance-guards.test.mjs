import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/economy.ts', import.meta.url), 'utf8');

test('daily reward validates both stored currency balances and safe resulting balances', () => {
  assert.match(source, /function readCurrencyBalance\(value: unknown\)/);
  assert.match(source, /typeof value !== 'number' && typeof value !== 'string'/);
  assert.match(source, /typeof value === 'string' && value\.trim\(\)\.length === 0/);
  assert.match(source, /!Number\.isSafeInteger\(balance\) \|\| balance < 0/);
  assert.match(source, /const creditsBefore = readCurrencyBalance\(p\.credits\)/);
  assert.match(source, /const crystalsBefore = readCurrencyBalance\(p\.crystals\)/);
  assert.match(source, /!Number\.isSafeInteger\(creditsAfter\) \|\| !Number\.isSafeInteger\(crystalsAfter\)/);
});

test('premium purchase rejects malformed crystal balances before charging', () => {
  const start = source.indexOf('export async function purchasePremiumAction');
  const action = source.slice(start);
  assert.match(action, /const crystals = readCurrencyBalance\(player\.crystals\)/);
  assert.ok(action.indexOf('readCurrencyBalance(player.crystals)') < action.indexOf('t.update(playerRef'));
});