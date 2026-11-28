import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFirebaseWebConfig, LOCAL_FIREBASE_EMULATOR_CONFIG } from '../src/firebase/config-resolver.ts';

const betaConfig = () => ({
  apiKey: 'beta-api-key',
  authDomain: 'forge-rivals-beta.firebaseapp.com',
  projectId: 'forge-rivals-beta',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:betaapp',
  storageBucket: 'forge-rivals-beta.firebasestorage.app',
  measurementId: 'G-BETA123',
});

test('emulator mode uses only the disposable emulator project configuration', () => {
  assert.deepEqual(
    resolveFirebaseWebConfig({}, true),
    LOCAL_FIREBASE_EMULATOR_CONFIG,
  );
});

test('hosted Firebase config is isolated to the explicit Beta project and supplied values', () => {
  const config = resolveFirebaseWebConfig(betaConfig(), false);
  assert.deepEqual(config, betaConfig());
  assert.equal(config.projectId, 'forge-rivals-beta');
  assert.notEqual(config.storageBucket, 'demo-forge-rivals.appspot.com');
});

test('hosted config never inherits the demo storage bucket when Beta omits an optional bucket', () => {
  const input = betaConfig();
  delete input.storageBucket;
  const config = resolveFirebaseWebConfig(input, false);
  assert.equal(config.projectId, 'forge-rivals-beta');
  assert.equal('storageBucket' in config, false);
});

test('hosted config rejects missing required Firebase Web fields', () => {
  for (const input of [
    {},
    { ...betaConfig(), apiKey: ' ' },
    { ...betaConfig(), authDomain: undefined },
    { ...betaConfig(), messagingSenderId: '' },
  ]) {
    assert.throws(
      () => resolveFirebaseWebConfig(input, false),
      /Missing Firebase Web configuration for forge-rivals-beta/,
    );
  }
});

test('hosted config rejects any Firebase project other than forge-rivals-beta', () => {
  for (const projectId of ['demo-forge-rivals', 'production', 'forge-rivals-staging']) {
    assert.throws(
      () => resolveFirebaseWebConfig({ ...betaConfig(), projectId }, false),
      /FIREBASE_PROJECT_MISMATCH/,
    );
  }
});
