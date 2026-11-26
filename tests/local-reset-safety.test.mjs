import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cleanReset = readFileSync(new URL('../src/app/actions/clean-season1-world.ts', import.meta.url), 'utf8');
const nuclearReset = readFileSync(new URL('../src/app/actions/nuclear-reset.ts', import.meta.url), 'utf8');

test('legacy Season 1 reset requires the exact disposable local emulator before database access', () => {
  const guard = cleanReset.indexOf("process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'true'");
  const projectFence = cleanReset.indexOf("configuredProject !== 'demo-forge-rivals'");
  const loopbackFence = cleanReset.indexOf('.test(emulatorHost)');
  const database = cleanReset.indexOf('const db = getAdminDb()');
  assert.ok(guard >= 0 && projectFence > guard && loopbackFence > projectFence);
  assert.ok(database > loopbackFence, 'all emulator and project guards must run before Admin SDK access');
});

test('nuclear reset requires the disposable demo project and local emulator before database access', () => {
  const guard = nuclearReset.indexOf("configuredProject !== 'demo-forge-rivals'");
  const loopbackFence = nuclearReset.indexOf('.test(emulatorHost)');
  const database = nuclearReset.indexOf('const db = getAdminDb()');
  assert.ok(guard >= 0 && loopbackFence > guard);
  assert.ok(database > loopbackFence, 'the Admin SDK must not initialize before destructive-operation fences');
});
