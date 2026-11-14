import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isTournamentMatchLeaseExpired, TOURNAMENT_MATCH_LEASE_MS } from '../src/app/lib/tournament-match-lease.ts';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('tournament processing lease expires only after its bounded timeout', () => {
  const now = 2_000_000;
  assert.equal(isTournamentMatchLeaseExpired(now - TOURNAMENT_MATCH_LEASE_MS + 1, now), false);
  assert.equal(isTournamentMatchLeaseExpired(now - TOURNAMENT_MATCH_LEASE_MS, now), true);
  assert.equal(isTournamentMatchLeaseExpired(now - TOURNAMENT_MATCH_LEASE_MS - 1, now), true);
});

test('tournament processing lease accepts Firestore-like timestamps and fails closed on invalid/future values', () => {
  const now = 5_000_000;
  assert.equal(isTournamentMatchLeaseExpired({ toMillis: () => now - TOURNAMENT_MATCH_LEASE_MS }, now), true);
  assert.equal(isTournamentMatchLeaseExpired(new Date(now + 1), now), false);
  assert.equal(isTournamentMatchLeaseExpired('not-a-date', now), false);
  assert.equal(isTournamentMatchLeaseExpired(undefined, now), false);
});

test('tournament match workers reclaim stale processing leases with a fencing token', () => {
  const source = read('src/app/actions/tournament-system.ts');
  assert.match(source, /status', 'in', \['scheduled', 'error', 'processing'\]/);
  assert.match(source, /isTournamentMatchLeaseExpired\(m\.processingAt, now, TOURNAMENT_MATCH_LEASE_MS\)/);
  assert.match(source, /processingToken = randomUUID\(\)/);
  assert.match(source, /freshData\.processingToken !== processingToken/);
  assert.match(source, /data\.processingToken !== processingToken/);
  assert.match(source, /TOURNAMENT_MATCH_RETRY_EXHAUSTED/);
  assert.match(source, /attempts >= 3/);
});
