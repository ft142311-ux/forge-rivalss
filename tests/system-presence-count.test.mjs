import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../src/app/api/system/status/route.ts', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../functions/manager-presence-policy.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('System online counter uses server-owned presence heartbeats, not profile login dates', () => {
  assert.match(route, /collection\('manager_presence_v1'\)/);
  assert.match(route, /where\('lastSeen', '>=', cutoff\)/);
  assert.match(route, /Timestamp\.fromDate/);
  assert.doesNotMatch(route, /lastLoginDate/);
  assert.match(route, /ONLINE_WINDOW_MS = 2 \* 60 \* 1000/);
});

test('Presence online policy uses a two-minute heartbeat window', () => {
  assert.match(policy, /ONLINE_WINDOW_MS = 2 \* 60 \* 1000/);
  assert.match(policy, /seenAt > now/);
});

test('Clients cannot read or write raw manager presence documents', () => {
  assert.match(rules, /match \/manager_presence_v1\/\{userId\} \{\s*allow read, write: if false;/);
});
