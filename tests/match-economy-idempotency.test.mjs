import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/match-economy.ts', import.meta.url), 'utf8');

test('match revenue validates its document identity and amount before opening a transaction', () => {
  const start = source.indexOf('export async function recordMatchEconomy');
  assert.ok(start >= 0);
  const action = source.slice(start);
  const idValidation = action.indexOf("assertMatchDocumentId(matchId, { rejectBackslash: true })");
  const amountValidation = action.indexOf('Number.isSafeInteger(amount)');
  const transaction = action.indexOf('db.runTransaction');
  assert.ok(idValidation >= 0 && amountValidation > idValidation && transaction > amountValidation);
  assert.match(action, /throw new Error\('INVALID_MATCH_ECONOMY_UID'\)/);
  assert.match(action, /throw new Error\('INVALID_MATCH_ECONOMY_AMOUNT'\)/);
});

test('replayed match revenue receipts are accepted only for the same user, match and amount', () => {
  const start = source.indexOf('export async function recordMatchEconomy');
  const action = source.slice(start);
  assert.match(action, /if \(txSnap\.exists\) \{/);
  assert.match(action, /receipt\.userId === uid/);
  assert.match(action, /receipt\.referenceId === matchId/);
  assert.match(action, /receipt\.currency === 'credits'/);
  assert.match(action, /receipt\.type === 'MATCH_REVENUE'/);
  assert.match(action, /Number\(receipt\.amount\) === amount/);
  assert.match(action, /throw new Error\('IDEMPOTENCY_KEY_REUSED'\)/);
});

test('match revenue rejects malformed, negative, fractional and overflowing club balances', () => {
  const start = source.indexOf('export async function recordMatchEconomy');
  const action = source.slice(start);
  const balanceRead = action.indexOf('const rawBalance = player.credits');
  const balanceGuard = action.indexOf("throw new Error('INVALID_MATCH_ECONOMY_BALANCE')");
  const firstWrite = action.indexOf('t.update(playerRef');
  assert.ok(balanceRead >= 0 && balanceGuard > balanceRead && firstWrite > balanceGuard);
  assert.match(action, /typeof rawBalance !== 'number' && typeof rawBalance !== 'string'/);
  assert.match(action, /typeof rawBalance === 'string' && rawBalance\.trim\(\)\.length === 0/);
  assert.match(action, /Number\.isSafeInteger\(before\) \|\| before < 0/);
  assert.match(action, /Number\.isSafeInteger\(after\) \|\| after < 0/);
  assert.match(action, /const after = before \+ amount/);
});

test('match revenue credits and ledger receipt use the same validated integer amount', () => {
  const start = source.indexOf('export async function recordMatchEconomy');
  const action = source.slice(start);
  assert.match(action, /const after = before \+ amount/);
  assert.match(action, /amount,/);
  assert.doesNotMatch(action, /before \+ economy\.totalRevenue/);
});

const autonomous = readFileSync(new URL('../src/app/actions/autonomous-cycle.ts', import.meta.url), 'utf8');

test('authoritative autonomous match settlement rejects malformed and overflowing balances before writes', () => {
  const start = autonomous.indexOf('if (homeRef && homeSnap?.exists && !economyTxSnap?.exists)');
  const action = autonomous.slice(start);
  const balanceRead = action.indexOf('const rawBalance = homePlayerData.credits');
  const balanceGuard = action.indexOf("throw new Error('INVALID_MATCH_ECONOMY_BALANCE')");
  const firstWrite = action.indexOf('Object.assign(homeUpdate');
  assert.ok(balanceRead >= 0 && balanceGuard > balanceRead && firstWrite > balanceGuard);
  assert.match(action, /Number\.isSafeInteger\(before\) \|\| before < 0/);
  assert.match(action, /Number\.isSafeInteger\(after\) \|\| after < 0/);
});

test('autonomous salary and match settlement reject boolean or malformed stored balances', () => {
  assert.match(autonomous, /function readSafeNonNegativeBalance\(value: unknown, errorCode: string\)/);
  assert.match(autonomous, /readSafeNonNegativeBalance\(data\.credits, 'INVALID_SALARY_BALANCE'\)/);
  assert.match(autonomous, /readSafeNonNegativeBalance\(homePlayerData\.credits, 'INVALID_MATCH_ECONOMY_BALANCE'\)/);
  assert.doesNotMatch(autonomous, /Math\.max\(0, Number\(data\.credits \|\| 0\)\)/);
});
