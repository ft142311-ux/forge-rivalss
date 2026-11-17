import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');

test('shop player creation declares one stable id in its own action scope', () => {
  const start = action.indexOf('export async function createShopPlayerAction');
  assert.notEqual(start, -1);
  const createAction = action.slice(start);
  assert.match(createAction, /const playerId = `shop_\$\{uid\}_\$\{randomUUID\(\)\}`;/);
  assert.match(createAction, /generateUniquePlayer\(parsedRole, owned\.length \+ youth\.length, false, playerId\)/);
  assert.match(createAction, /id: playerId,/);
  assert.doesNotMatch(action.slice(0, start), /const playerId =/);
});

test('club identity changes record before and after balances in the economy ledger', () => {
  const renameStart = action.indexOf('export async function changeClubNameAction');
  const countryStart = action.indexOf('export async function changeClubCountryAction');
  const createStart = action.indexOf('export async function createShopPlayerAction');
  const rename = action.slice(renameStart, countryStart);
  const country = action.slice(countryStart, createStart);
  assert.match(rename, /balanceBefore: crystals, balanceAfter: crystals - 100/);
  assert.match(country, /balanceBefore: crystals, balanceAfter: crystals - 100/);
});
