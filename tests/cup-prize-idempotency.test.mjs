import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup prize replay validates the deterministic receipt and preserves the original credited amount', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  assert.ok(start >= 0 && end > start);
  const payout = source.slice(start, end);
  const receiptGuard = payout.indexOf('if (ledgerSnap.exists)');
  const playerGuard = payout.indexOf('if (!playerSnap.exists)');
  assert.ok(receiptGuard >= 0 && playerGuard > receiptGuard);
  const replay = payout.slice(receiptGuard, playerGuard);
  assert.match(replay, /resolveCupPrizeReplayAmount\(receipt/);
  assert.match(replay, /if \(replayAmount === null\) throw new Error\('CUP_PRIZE_RECEIPT_CONFLICT'\)/);
  assert.match(replay, /return replayAmount/);
  assert.doesNotMatch(replay, /return 0/);
});

test('Pyramid Cup reward balance and ledger are created in the same transaction', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const payout = source.slice(start, end);
  assert.match(payout, /return db\.runTransaction\(async \(tx: any\) =>/);
  assert.match(payout, /tx\.update\(playerRef, \{[\s\S]*credits: before \+ amount/);
  assert.match(payout, /tx\.create\(ledgerRef, \{/);
});


test('Pyramid Cup preserves the existing division-based champion prize and finalist percentage policy', () => {
  assert.match(source, /DIVISION_CHAMPION_PRIZES: Record<number, number> = \{ 1: 4_000_000, 2: 1_800_000, 3: 900_000, 4: 350_000 \}/);
  assert.match(source, /Math\.floor\(base \* \(place === 'champion' \? 0\.10 : 0\.05\)\)/);
  assert.doesNotMatch(source, /DIVISION_CUP_PRIZES/);
});

test('Pyramid Cup never pays bots and never creates a zero-value receipt', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const payout = source.slice(start, end);
  assert.match(payout, /team\.id\.startsWith\('BOT_'\)/);
  assert.match(payout, /if \(amount <= 0\) return 0/);
});

test('Pyramid Cup champion receives one separate trophy in the same payout transaction; finalist receives none', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  const payout = source.slice(start, end);
  assert.match(payout, /const trophyId = `pyramid-cup-season-\$\{season\}`/);
  assert.match(payout, /const shouldAddTrophy = place === 'champion' && !hasPyramidCupTrophy/);
  assert.match(payout, /type: 'pyramid_cup_champion'/);
  assert.match(payout, /name: `Кубок Пирамиды — сезон \$\{season\}`/);
  assert.match(payout, /trophies: \[\.\.\.existingTrophies/);
  assert.match(payout, /tx\.update\(playerRef, \{/);
  assert.match(payout, /tx\.create\(ledgerRef, \{/);
});
