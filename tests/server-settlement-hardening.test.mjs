import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('cron secret verifier fails closed and uses a constant-time comparison', () => {
  const source = read('src/lib/server-cron-auth.ts');
  assert.match(source, /if \(typeof candidate !== 'string' \|\| !configured\)/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /CRON_AUTH_REQUIRED/);
});

test('global foundation cycle requires the server cron secret and paginates', () => {
  const source = read('src/app/actions/foundation-cycle.ts');
  assert.match(source, /runFoundationDailyCycle\(cronSecret: string\)/);
  assert.match(source, /assertCronSecret\(cronSecret\)/);
  assert.match(source, /orderBy\(FieldPath\.documentId\(\)\)[\s\S]{0,80}limit\(pageSize\)/);
});

test('global friendly resolver requires the server cron secret and paginates', () => {
  const source = read('src/app/actions/friendly-matchmaking.ts');
  assert.match(source, /resolveDueFriendlyMatches\(cronSecret: string\)/);
  assert.match(source, /assertCronSecret\(cronSecret\)/);
  assert.match(source, /orderBy\(FieldPath\.documentId\(\)\)[\s\S]{0,80}limit\(pageSize\)/);
});

test('expired friendly lobby deletions commit before the action reports expiry', () => {
  const source = read('src/app/actions/friendly-matchmaking.ts');
  assert.match(source, /t\.delete\(lobbyRef\);\s*return \{ expired: true as const \}/);
  assert.match(source, /transactionResult\?\.expired/);
  assert.match(source, /return \{ success: false as const, expired: true as const \}/);
  assert.match(source, /'expired' in result && result\.expired/);
});

test('league match result and its player/economy effects are committed in one transaction', () => {
  const source = read('src/app/actions/autonomous-cycle.ts');
  assert.match(source, /const settled = await db\.runTransaction/);
  assert.match(source, /tx\.update\(matchDoc\.ref, \{/);
  assert.match(source, /match_player_effects_v1/);
  assert.match(source, /MATCH_SELF_PLAY_INVALID/);
  assert.match(source, /economyTxRef/);
  assert.match(source, /settlementVersion: 1/);
});

test('email verification uses a cryptographic code and caps failed attempts', () => {
  const source = read('src/app/actions/email.ts');
  assert.match(source, /randomInt\(100000, 1000000\)/);
  assert.match(source, /MAX_VERIFICATION_ATTEMPTS = 5/);
  assert.match(source, /verification_rate_limits/);
  assert.match(source, /lastSentAt/);
  assert.match(source, /attemptsRemaining/);
  assert.match(source, /TOO_MANY_ATTEMPTS/);
  assert.match(source, /db\.runTransaction/);
});

test('transfer-market expiry sweep paginates instead of loading the full collection at once', () => {
  const source = read('src/app/actions/autonomous-cycle.ts');
  assert.match(source, /market\.orderBy\(FieldPath\.documentId\(\)\)\.limit\(pageSize\)/);
  assert.match(source, /scanned,\s*due: due\.length/);
});

test('cron routes pass the configured secret into internal worker actions', () => {
  const foundationRoute = read('src/app/api/cron/foundation-cycle/route.ts');
  const dailyRoute = read('src/app/api/cron/daily-settlement/route.ts');
  const friendlyRoute = read('src/app/api/cron/resolve-friendly-matches/route.ts');
  const combinedRoute = read('src/app/api/cron/resolve-matches/route.ts');
  assert.match(foundationRoute, /runFoundationDailyCycle\(process\.env\.CRON_SECRET/);
  assert.match(dailyRoute, /runFoundationDailyCycle\(process\.env\.CRON_SECRET/);
  assert.match(friendlyRoute, /resolveDueFriendlyMatches\(process\.env\.CRON_SECRET/);
  assert.match(combinedRoute, /resolveDueFriendlyMatches\(cronSecret\)/);
});
