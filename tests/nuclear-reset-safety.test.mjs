import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const reset = read('../src/app/actions/nuclear-reset.ts');
const adminActions = read('../src/app/actions/admin-actions.ts');

test('nuclear reset is an internal server module, not a directly exposed Server Action', () => {
  assert.match(reset, /^import ['"]server-only['"];/);
  assert.doesNotMatch(reset, /^['"]use server['"];/);
});

test('nuclear reset refuses to run unless the local Firebase emulator is explicitly enabled', () => {
  const guardIndex = reset.indexOf("process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'true'");
  const dbIndex = reset.indexOf('const db = adminDb;');
  assert.notEqual(guardIndex, -1, 'missing explicit emulator-mode guard');
  assert.ok(dbIndex > guardIndex, 'database access must happen only after emulator-mode guard');
  assert.match(reset, /LOCAL_EMULATOR_REQUIRED/);
  assert.match(reset, /LOCAL_FIRESTORE_EMULATOR_REQUIRED/);
  assert.match(reset, /127\\\\.0\\\\.0\\\\.1|localhost/);
});

test('the browser-facing nuclear reset action requires an authenticated admin', () => {
  assert.match(adminActions, /export async function totalNuclearResetAction/);
  assert.match(adminActions, /totalNuclearResetAction\\(idToken: string\\)[\\s\\S]*?requireAdminActor\\(idToken\\)/);
});
