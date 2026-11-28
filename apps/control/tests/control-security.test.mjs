import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const admin = read('../lib/firebase-admin.ts');
const route = read('../app/api/overview/route.ts');
const bootstrap = read('../app/api/bootstrap-admin/route.ts');
const client = read('../lib/firebase-client.ts');
const page = read('../app/page.tsx');
const docs = read('../README.md');

test('Control server pins Admin SDK to Beta and validates service-account project', () => {
  assert.match(admin, /const PROJECT = 'forge-rivals-beta'/);
  assert.match(admin, /configured !== PROJECT/);
  assert.match(admin, /account\.project_id !== PROJECT/);
});

test('Every overview request verifies a non-revoked token and admin claim', () => {
  assert.match(admin, /verifyIdToken\(token, true\)/);
  assert.match(admin, /decoded\.admin !== true/);
  assert.doesNotMatch(admin, /CONTROL_ADMIN_UIDS/);
  assert.match(route, /requireControlAdmin\(match\[1\]\)/);
});

test('Bootstrap is Beta-only, secret-gated, one-time and grants only admin claim', () => {
  assert.match(bootstrap, /GCLOUD_PROJECT !== PROJECT/);
  assert.match(bootstrap, /BOOTSTRAP_ADMIN_SECRET/);
  assert.match(bootstrap, /timingSafeEqual/);
  assert.match(bootstrap, /tx\.create\(lockRef/);
  assert.match(bootstrap, /setCustomUserClaims\(user\.uid, \{ admin: true \}\)/);
  assert.match(bootstrap, /PASSWORD_POLICY_REQUIRES_12_TO_128_CHARACTERS/);
});

test('Client config is pinned to Beta and never contains Admin SDK credentials', () => {
  assert.match(client, /config\.projectId !== 'forge-rivals-beta'/);
  assert.match(client, /getApp\(APP_NAME\)/);
  assert.doesNotMatch(page, /firebase-admin|FIREBASE_ADMIN_SDK/);
  assert.match(page, /api\/bootstrap-admin/);
});

test('Initial overview remains read-only and docs require removal of bootstrap secret', () => {
  assert.match(route, /collection\('players_v14'\)\.count\(\)/);
  assert.match(route, /listUsers\(1000, pageToken\)/);
  assert.match(route, /page\.users\.filter\(\(user\) => !user\.disabled\)/);
  assert.match(route, /registeredHumans,/);
  assert.match(page, /Зарегистрировано людей/);
  assert.match(page, /включая ботов/);
  assert.match(route, /collection\('system_v1'\)\.doc\('season_config'\)/);
  assert.doesNotMatch(route, /(?:tx|batch|ref)\.(?:set|update|delete|create|add)\(/);
  assert.doesNotMatch(page, /nuclear|reset|delete/i);
  assert.match(docs, /remove.*BOOTSTRAP_ADMIN_SECRET/is);
});
