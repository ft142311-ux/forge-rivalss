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

test('nuclear reset refuses to access Firestore unless the local emulator is explicitly enabled', () => {
  const modeGuardIndex = reset.indexOf("process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'true'");
  const hostGuardIndex = reset.indexOf('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
  const dbAccessIndex = reset.indexOf('const db = getAdminDb();');

  assert.notEqual(modeGuardIndex, -1, 'missing explicit emulator-mode guard');
  assert.notEqual(hostGuardIndex, -1, 'missing loopback Firestore host guard');
  assert.ok(dbAccessIndex > modeGuardIndex, 'Admin DB must be initialized after emulator-mode guard');
  assert.ok(dbAccessIndex > hostGuardIndex, 'Admin DB must be initialized after loopback host guard');
  assert.match(reset, /LOCAL_EMULATOR_REQUIRED/);
  assert.match(reset, /LOCAL_FIRESTORE_EMULATOR_REQUIRED/);
});

test('the browser-facing nuclear reset action requires an authenticated admin', () => {
  assert.match(adminActions, /export async function totalNuclearResetAction\(idToken: string\)/);
  assert.match(adminActions, /totalNuclearResetAction\(idToken: string\)\s*\{\s*await requireAdminActor\(idToken\);\s*return totalNuclearResetV131\(\);/);
});
