import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup prize replay validates the existing deterministic receipt before no-op', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  assert.ok(start >= 0 && end > start);
  const payout = source.slice(start, end);
  const receiptGuard = payout.indexOf('if (ledgerSnap.exists)');
  const noOp = payout.indexOf('return 0;', receiptGuard);
  const playerGuard = payout.indexOf('if (!playerSnap.exists)');
  assert.ok(receiptGuard >= 0 && noOp > receiptGuard && playerGuard > receiptGuard);
  assert.match(payout, /receipt\.userId === team\.id/);
  assert.match(payout, /receipt\.amount === amount/);
  assert.match(payout, /receipt\.currency === 'credits'/);
  assert.match(payout, /receipt\.type === rewardType/);
  assert.match(payout, /receipt\.referenceId === referenceId/);
  assert.match(payout, /Number\(receipt\.division\) === Number\(team\.level\)/);
  assert.match(payout, /CUP_PRIZE_RECEIPT_CONFLICT/);
});

test('Pyramid Cup reward balance and ledger are created in the same transaction', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const payout = source.slice(start, end);
  assert.match(payout, /return db\.runTransaction\(async \(tx: any\) =>/);
  assert.match(payout, /tx\.update\(playerRef, \{ credits: before \+ amount/);
  assert.match(payout, /tx\.create\(ledgerRef, \{/);
});

test('Pyramid Cup champion and finalist rewards match the approved division prize table exactly', () => {
  assert.match(source, /1: \{ champion: 4_000_000, finalist: 3_600_000 \}/);
  assert.match(source, /2: \{ champion: 1_800_000, finalist: 1_650_000 \}/);
  assert.match(source, /3: \{ champion: 900_000, finalist: 800_000 \}/);
  assert.match(source, /4: \{ champion: 350_000, finalist: 300_000 \}/);
  assert.match(source, /DIVISION_CUP_PRIZES\[team\.level\]\?\.\[place\]/);
  assert.doesNotMatch(source, /DIVISION_CHAMPION_PRIZES|place === 'champion' \? 0\.10 : 0\.05/);
});

test('Pyramid Cup never pays bots and never creates a zero-value receipt', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const payout = source.slice(start, end);
  assert.match(payout, /team\.id\.startsWith\('BOT_'\)/);
  assert.match(payout, /if \(amount <= 0\) return 0/);
});
