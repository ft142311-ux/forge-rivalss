import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SeasonWriteFence,
  SeasonWriteFenceError,
} from '../src/app/actions/season-write-fence.ts';

function tokens(...values) {
  let index = 0;
  return () => values[index++];
}

function acquire(fence, ownerId, version = 'state-v1', nowMs = 100) {
  const result = fence.acquire({ ownerId, season: 1, expectedCanonicalVersion: version, nowMs, ttlMs: 100 });
  assert.equal(result.acquired, true);
  return result.lease;
}

test('two competing acquire calls allow only one active lease', () => {
  const fence = new SeasonWriteFence(tokens('token-a', 'token-b'));
  const first = fence.acquire({ ownerId: 'A', season: 1, expectedCanonicalVersion: 'v1', nowMs: 100, ttlMs: 50 });
  const second = fence.acquire({ ownerId: 'B', season: 1, expectedCanonicalVersion: 'v1', nowMs: 100, ttlMs: 50 });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'LEASE_ACTIVE');
});

test('epoch is monotonic and never reused after release or expiry', () => {
  const fence = new SeasonWriteFence(tokens('token-a', 'token-b', 'token-c'));
  const first = acquire(fence, 'A');
  assert.equal(fence.release(first, 110).released, true);
  const second = acquire(fence, 'B', 'state-v1', 120);
  assert.equal(second.epoch > first.epoch, true);
  const thirdResult = fence.acquire({ ownerId: 'C', season: 1, expectedCanonicalVersion: 'state-v1', nowMs: 221, ttlMs: 20 });
  assert.equal(thirdResult.acquired, true);
  assert.equal(thirdResult.lease.epoch > second.epoch, true);
  assert.notEqual(thirdResult.lease.epoch, first.epoch);
});

test('stale token cannot assert or release a replacement lease', () => {
  const fence = new SeasonWriteFence(tokens('old-token', 'new-token'));
  const oldLease = acquire(fence, 'old');
  assert.equal(fence.release(oldLease, 201).released, false); // expired, but still current
  const newLease = acquire(fence, 'new', 'v1', 201);
  assert.throws(() => fence.assert(oldLease, { season: 1, canonicalVersion: 'v1', nowMs: 202 }), error => error instanceof SeasonWriteFenceError && error.code === 'FENCE_NOT_HELD');
  assert.deepEqual(fence.release(oldLease, 202), { released: false, reason: 'NOT_CURRENT_OWNER' });
  assert.deepEqual(fence.release(newLease, 202), { released: true });
});

test('expired lease is rejected before a subject write can proceed', () => {
  const fence = new SeasonWriteFence(tokens('token'));
  const lease = acquire(fence, 'writer', 'v1', 100);
  assert.throws(() => fence.assert(lease, { season: 1, canonicalVersion: 'v1', nowMs: 200 }), error => error instanceof SeasonWriteFenceError && error.code === 'FENCE_EXPIRED');
});

test('ABA lease attempt gets a new epoch and old lease remains invalid', () => {
  const fence = new SeasonWriteFence(tokens('token-a', 'token-b'));
  const first = acquire(fence, 'A', 'v1', 100);
  assert.equal(fence.release(first, 110).released, true);
  const replacement = acquire(fence, 'B', 'v1', 120);
  assert.notEqual(replacement.token, first.token);
  assert.notEqual(replacement.epoch, first.epoch);
  assert.throws(() => fence.assert(first, { season: 1, canonicalVersion: 'v1', nowMs: 121 }), /FENCE_NOT_HELD/);
});

test('canonical version conflict blocks the first write', () => {
  const fence = new SeasonWriteFence(tokens('token'));
  const lease = acquire(fence, 'writer', 'canonical-v1');
  assert.throws(() => fence.assert(lease, { season: 1, canonicalVersion: 'canonical-v2', nowMs: 101 }), error => error instanceof SeasonWriteFenceError && error.code === 'CANONICAL_VERSION_CHANGED');
});

test('release is owner-, token-, epoch-, and expiry-safe', () => {
  const fence = new SeasonWriteFence(tokens('token'));
  const lease = acquire(fence, 'owner');
  assert.deepEqual(fence.release({ ...lease, ownerId: 'other' }, 101), { released: false, reason: 'NOT_CURRENT_OWNER' });
  assert.deepEqual(fence.release(lease, 201), { released: false, reason: 'LEASE_EXPIRED' });
});

test('returned lease snapshots cannot mutate internal fence state', () => {
  const fence = new SeasonWriteFence(tokens('token'));
  const lease = acquire(fence, 'owner', 'v1');
  const trustedSnapshot = { ...lease };
  lease.token = 'forged-token';
  lease.epoch = 999;
  lease.expiresAtMs = 0;
  const inspected = fence.getCurrentLease();
  inspected.token = 'forged-inspection-token';
  inspected.expiresAtMs = 0;
  assert.equal(fence.assert(trustedSnapshot, { season: 1, canonicalVersion: 'v1', nowMs: 101 }), true);
  assert.equal(fence.getCurrentLease().token, 'token');
});

test('invalid time, ttl, owner, version, token, and epoch overflow are rejected', () => {
  const invalidInputs = [
    { ownerId: 'owner', season: 1, expectedCanonicalVersion: 'v1', nowMs: NaN, ttlMs: 10 },
    { ownerId: 'owner', season: 1, expectedCanonicalVersion: 'v1', nowMs: -1, ttlMs: 10 },
    { ownerId: 'owner', season: 1, expectedCanonicalVersion: 'v1', nowMs: 1, ttlMs: 0 },
    { ownerId: '', season: 1, expectedCanonicalVersion: 'v1', nowMs: 1, ttlMs: 10 },
    { ownerId: 'owner', season: 1, expectedCanonicalVersion: '', nowMs: 1, ttlMs: 10 },
  ];
  for (const input of invalidInputs) {
    assert.throws(() => new SeasonWriteFence(tokens('token')).acquire(input), /INVALID_INPUT/);
  }
  assert.throws(
    () => new SeasonWriteFence(() => '').acquire({ ownerId: 'owner', season: 1, expectedCanonicalVersion: 'v1', nowMs: 1, ttlMs: 10 }),
    /INVALID_INPUT/,
  );
  const fence = new SeasonWriteFence(tokens('token'));
  fence.nextEpoch = Number.MAX_SAFE_INTEGER;
  assert.throws(() => fence.acquire({ ownerId: 'owner', season: 1, expectedCanonicalVersion: 'v1', nowMs: 1, ttlMs: 10 }), /EPOCH_EXHAUSTED/);
});

test('renew requires the current canonical version and extends the same epoch', () => {
  const fence = new SeasonWriteFence(tokens('token'));
  const lease = acquire(fence, 'writer', 'v1', 100);
  const renewed = fence.renew(lease, { season: 1, canonicalVersion: 'v1', nowMs: 150 }, 100);
  assert.equal(renewed.epoch, lease.epoch);
  assert.equal(renewed.expiresAtMs, 250);
  assert.throws(() => fence.renew(renewed, { season: 1, canonicalVersion: 'v2', nowMs: 160 }, 100), /CANONICAL_VERSION_CHANGED/);
});

test('a fake chunk commit checks the fence atomically before every chunk', () => {
  const fence = new SeasonWriteFence(tokens('token-a'));
  const lease = acquire(fence, 'writer', 'v1');
  const writes = [];
  const commitChunk = (canonicalVersion, nowMs, values) => {
    fence.assert(lease, { season: 1, canonicalVersion, nowMs });
    writes.push(...values);
  };

  commitChunk('v1', 110, ['table-1']);
  assert.throws(() => commitChunk('v2', 111, ['table-2']), /CANONICAL_VERSION_CHANGED/);
  assert.deepEqual(writes, ['table-1']);
});

test('concurrent fake writers cannot both commit under one fence', async () => {
  const fence = new SeasonWriteFence(tokens('token-a', 'token-b'));
  const writes = [];
  const attempt = async ownerId => {
    const result = fence.acquire({ ownerId, season: 1, expectedCanonicalVersion: 'v1', nowMs: 100, ttlMs: 100 });
    if (!result.acquired) return false;
    fence.assert(result.lease, { season: 1, canonicalVersion: 'v1', nowMs: 101 });
    writes.push(ownerId);
    return true;
  };
  const results = await Promise.all([attempt('A'), attempt('B')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(writes.length, 1);
});
