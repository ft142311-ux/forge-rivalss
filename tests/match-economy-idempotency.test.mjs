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

test('match revenue credits and ledger receipt use the same validated integer amount', () => {
  const start = source.indexOf('export async function recordMatchEconomy');
  const action = source.slice(start);
  assert.match(action, /const after = before \+ amount/);
  assert.match(action, /amount,/);
  assert.doesNotMatch(action, /before \+ economy\.totalRevenue/);
});
