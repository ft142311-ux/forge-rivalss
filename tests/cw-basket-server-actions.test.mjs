import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const action = read('../src/app/actions/cw-basket.ts');
const friendly = read('../src/app/actions/friendly-matchmaking.ts');
const page = read('../src/app/tournaments/cw-basket/page.tsx');
const rules = read('../firestore.rules');

 test('CW Basket queue mutations are authenticated and transaction-backed', () => {
  assert.match(action, /requireServerActor\(idToken\)/);
  assert.match(action, /export async function joinCwBasketQueueAction/);
  assert.match(action, /export async function cancelCwBasketQueueAction/);
  assert.match(action, /db\.runTransaction/);
  assert.match(action, /where\('status', '==', 'searching'\)/);
  assert.match(action, /CW_QUEUE_TTL_MS/);
  assert.match(action, /CW_MATCH_DELAY_MS = 15 \* 60 \* 1000/);
});

test('CW Basket pairing creates one canonical scheduled BO2 association match', () => {
  assert.match(action, /t\.create\(matchRef/);
  assert.match(action, /matchType: 'basket'/);
  assert.match(action, /source: 'cw-basket'/);
  assert.match(action, /MATCH_COLLECTIONS\.association/);
  assert.match(action, /matchStartTime: scheduledStartAt\.toDate\(\)\.toISOString\(\)/);
  assert.match(friendly, /const matchType = String\(match\.matchType \|\| 'friendly'\)/);
  assert.match(friendly, /mode: matchType === 'basket' \? 'cw-basket' : 'friendly'/);
  assert.match(friendly, /if \(matchType === 'basket'\)/);
  assert.match(friendly, /t\.delete\(queueSnap\.ref\)/);
});

test('CW Basket client uses only server actions and observes its own queue record', () => {
  assert.match(page, /joinCwBasketQueueAction/);
  assert.match(page, /cancelCwBasketQueueAction/);
  assert.match(page, /doc\(db, 'cw_basket_v2', user\.uid\)/);
  assert.doesNotMatch(page, /setDoc\(|deleteDoc\(|updateDoc\(/);
});

test('CW Basket queue is client-readable only by its owner and never client-writable', () => {
  const match = rules.match(/match \/cw_basket_v2\/\{userId\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, 'cw_basket_v2 rule block exists');
  assert.match(match[1], /allow read: if signedIn\(\) && request\.auth\.uid == userId/);
  assert.match(match[1], /allow write: if false/);
});
