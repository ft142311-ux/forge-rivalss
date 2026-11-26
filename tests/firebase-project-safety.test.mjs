import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebaserc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
const firebase = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));

test('Firebase CLI defaults to the disposable demo project, never a hosted environment', () => {
  assert.equal(firebaserc.projects.default, 'demo-forge-rivals');
  assert.notEqual(firebaserc.projects.default, 'forge-rivals-beta');
  assert.notEqual(firebaserc.projects.default, 'production');
});

test('Firebase Emulator Suite uses the documented local-only ports', () => {
  assert.equal(firebase.emulators.auth.port, 9099);
  assert.equal(firebase.emulators.firestore.port, 8080);
  assert.equal(firebase.emulators.functions.port, 5001);
  assert.equal(firebase.emulators.ui.port, 4000);
});
