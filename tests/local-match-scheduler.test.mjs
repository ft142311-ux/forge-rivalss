import test from 'node:test';
import assert from 'node:assert/strict';
import scheduler from '../scripts/local-match-scheduler.cjs';

const safeEnv = {
  NODE_ENV: 'development',
  GCLOUD_PROJECT: 'demo-forge-rivals',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
  CRON_SECRET: 'local-test-secret-at-least-16',
};

test('local scheduler accepts only the expected local emulator configuration', () => {
  const result = scheduler.validateLocalSchedulerConfig(safeEnv);
  assert.equal(result.ok, true);
  assert.equal(result.projectId, 'demo-forge-rivals');
  assert.equal(result.intervalMs, scheduler.DEFAULT_INTERVAL_MS);
});

test('local scheduler rejects a wrong Auth emulator port', () => {
  const result = scheduler.validateLocalSchedulerConfig({ ...safeEnv, FIREBASE_AUTH_EMULATOR_HOST: 'localhost:8080' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('FIREBASE_AUTH_EMULATOR_HOST')));
});

test('local scheduler blocks production mode', () => {
  const result = scheduler.validateLocalSchedulerConfig({ ...safeEnv, NODE_ENV: 'production' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('production')));
});

test('local scheduler blocks a non-emulator project or remote Firestore', () => {
  const result = scheduler.validateLocalSchedulerConfig({
    ...safeEnv,
    GCLOUD_PROJECT: 'real-production-project',
    FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('GCLOUD_PROJECT')));
  assert.ok(result.errors.some(error => error.includes('FIRESTORE_EMULATOR_HOST')));
});

test('local scheduler requires emulator mode, local Auth and a cron secret', () => {
  const result = scheduler.validateLocalSchedulerConfig({
    ...safeEnv,
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'false',
    FIREBASE_AUTH_EMULATOR_HOST: 'identitytoolkit.googleapis.com:443',
    CRON_SECRET: 'short',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
});

test('local scheduler rejects unsafe polling intervals', () => {
  const result = scheduler.validateLocalSchedulerConfig({ ...safeEnv, LOCAL_MATCH_SCHEDULER_INTERVAL_MS: '1000' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('INTERVAL')));
});
