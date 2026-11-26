import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSeasonOrchestratorLock,
  isSeasonOrchestratorLockExpired,
  releaseSeasonOrchestratorLock,
  SEASON_ORCHESTRATOR_LOCK_ID,
  SEASON_ORCHESTRATOR_LOCK_TTL_MS,
} from '../src/app/actions/season-orchestrator-lock.ts';
import { isSeasonOrchestratorSuccessful, cronResultStatus } from '../src/app/api/cron/cron-result.ts';

function createFakeDb() {
  const docs = new Map();
  let transactionQueue = Promise.resolve();
  const ref = { id: SEASON_ORCHESTRATOR_LOCK_ID };
  const db = {
    collection(name) {
      assert.equal(name, 'system_v1');
      return { doc(id) { assert.equal(id, SEASON_ORCHESTRATOR_LOCK_ID); return ref; } };
    },
    async runTransaction(callback) {
      const tx = {
        async get() {
          const value = docs.get(ref.id);
          return { exists: Boolean(value), data: () => value ? structuredClone(value) : undefined };
        },
        set(_ref, value, options) {
          docs.set(ref.id, options?.merge ? { ...(docs.get(ref.id) || {}), ...value } : structuredClone(value));
        },
        delete() { docs.delete(ref.id); },
      };
      const pending = transactionQueue.then(() => callback(tx));
      transactionQueue = pending.catch(() => undefined);
      return pending;
    },
    read() { return docs.get(ref.id); },
  };
  return db;
}

test('only one concurrent scheduler invocation acquires the global lease', async () => {
  const db = createFakeDb();
  const nowMs = 10_000;
  const [first, second] = await Promise.all([
    acquireSeasonOrchestratorLock(db, { nowMs }),
    acquireSeasonOrchestratorLock(db, { nowMs }),
  ]);
  assert.equal([first, second].filter(result => result.acquired).length, 1);
  assert.equal([first, second].filter(result => !result.acquired).length, 1);
  assert.equal(db.read().expiresAtMs, nowMs + SEASON_ORCHESTRATOR_LOCK_TTL_MS);
});

test('expired leases can be reclaimed with a fresh fencing token', async () => {
  const db = createFakeDb();
  const first = await acquireSeasonOrchestratorLock(db, { nowMs: 1_000, ttlMs: 100, ownerId: 'worker-a' });
  const second = await acquireSeasonOrchestratorLock(db, { nowMs: 1_100, ttlMs: 100, ownerId: 'worker-a' });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, true);
  assert.notEqual(first.token, second.token);
  assert.equal(second.expiresAtMs, 1_200);
});

test('a stale owner cannot release a replacement worker lease', async () => {
  const db = createFakeDb();
  const first = await acquireSeasonOrchestratorLock(db, { nowMs: 1_000, ttlMs: 100, ownerId: 'worker-a' });
  const second = await acquireSeasonOrchestratorLock(db, { nowMs: 1_100, ttlMs: 100, ownerId: 'worker-b' });
  assert.deepEqual(await releaseSeasonOrchestratorLock(db, first.ownerId, first.token), { released: false });
  assert.equal(db.read().ownerId, second.ownerId);
  assert.deepEqual(await releaseSeasonOrchestratorLock(db, second.ownerId, second.token), { released: true });
  assert.equal(db.read(), undefined);
});

test('lock expiry fails closed for missing, invalid, and elapsed deadlines', () => {
  assert.equal(isSeasonOrchestratorLockExpired(null, 100), true);
  assert.equal(isSeasonOrchestratorLockExpired({ expiresAtMs: 'invalid' }, 100), true);
  assert.equal(isSeasonOrchestratorLockExpired({ expiresAtMs: 100 }, 100), true);
  assert.equal(isSeasonOrchestratorLockExpired({ expiresAtMs: 101 }, 100), false);
});

test('orchestrator acquires before work and always releases its lease', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../src/app/actions/season-cycle.ts', import.meta.url), 'utf8');
  assert.match(source, /const lock = await acquireSeasonOrchestratorLock\(db\)/);
  assert.match(source, /if \(!lock\.acquired\)[\s\S]*?ORCHESTRATOR_LOCKED/);
  assert.match(source, /finally \{\s*\/\/ Cleanup is best-effort[\s\S]*?try \{\s*await releaseSeasonOrchestratorLock\(db, lock\.ownerId, lock\.token\);\s*\} catch \(releaseError: any\)/);
  assert.match(source, /Failed to release season orchestrator lease; it will expire by TTL/);
  assert.match(source, /async function runSeasonOrchestratorUnlocked\(\)/);
});

test('overlapping orchestrator tick is a successful no-op for the cron caller', () => {
  const result = { action: 'ORCHESTRATOR_LOCKED', success: true, skipped: true, writesStarted: false };
  assert.equal(isSeasonOrchestratorSuccessful(result), true);
  assert.equal(cronResultStatus({ ...result, success: isSeasonOrchestratorSuccessful(result) }), 200);
});
