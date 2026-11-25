import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const admin = read('../lib/firebase-admin.ts');
const route = read('../app/api/overview/route.ts');
const client = read('../lib/firebase-client.ts');
const page = read('../app/page.tsx');

test('Control server pins Admin SDK to Beta and validates service-account project', () => {
  assert.match(admin, /const PROJECT = 'forge-rivals-beta'/);
  assert.match(admin, /configured !== PROJECT/);
  assert.match(admin, /account\.project_id !== PROJECT/);
});

test('Every overview request verifies a non-revoked token, admin claim, and UID allowlist', () => {
  assert.match(admin, /verifyIdToken\(token, true\)/);
  assert.match(admin, /decoded\.admin !== true/);
  assert.match(admin, /CONTROL_ADMIN_UIDS/);
  assert.match(route, /requireControlAdmin\(match\[1\]\)/);
});

test('Client configuration cannot point this control app to another Firebase project', () => {
  assert.match(client, /config\.projectId !== 'forge-rivals-beta'/);
  assert.match(client, /getApps\(\)\.some\(existing => existing\.name === APP_NAME\)/);
  assert.match(client, /getApp\(APP_NAME\)/);
  assert.doesNotMatch(page, /firebase-admin|FIREBASE_ADMIN_SDK|CONTROL_ADMIN_UIDS/);
});

test('Initial overview exposes read-only aggregate data and no destructive operation', () => {
  assert.match(route, /collection\('players_v14'\)\.count\(\)/);
  assert.match(route, /collection\('system_v1'\)\.doc\('season_config'\)/);
  assert.doesNotMatch(route, /\.set\(|\.update\(|\.delete\(|\.add\(/);
  assert.doesNotMatch(page, /nuclear|reset|delete|bootstrap/i);
});
