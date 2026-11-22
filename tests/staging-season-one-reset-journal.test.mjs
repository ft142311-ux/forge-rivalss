import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResetJournal,
  acquireResetLease,
  startResetOperation,
  completeResetOperation,
  failResetOperation,
  recoverResetJournal,
} from '../src/app/actions/staging-season-one-reset-journal.ts';

function claimedJournal(idempotent = ['archive-season-data']) {
  const created = createResetJournal(
    'beta-season-one-reset-test',
    ['archive-season-data', 'replace-league-fixtures', 'publish-season-config'],
    1000,
    idempotent,
  );
  return acquireResetLease(created, 'worker-a', 'lease-a', 1100, 5000, 0).journal;
}

test('reset journal enforces exclusive lease and optimistic revision checks', () => {
  const journal = claimedJournal();
  const competing = acquireResetLease(journal, 'worker-b', 'lease-b', 1200, 5000, journal.revision);
  assert.equal(competing.changed, false);
  assert.equal(competing.reason, 'RESET_LOCKED');

  const stale = acquireResetLease(journal, 'worker-a', 'lease-a', 1200, 5000, 0);
  assert.equal(stale.changed, false);
  assert.equal(stale.reason, 'REVISION_CONFLICT');
});

test('reset journal enforces ordered execution and records completion', () => {
  let journal = claimedJournal();
  const outOfOrder = startResetOperation(journal, 'publish-season-config', 'lease-a', 1300, journal.revision);
  assert.equal(outOfOrder.changed, false);
  assert.equal(outOfOrder.reason, 'RESET_OPERATION_ORDER_INVALID');

  let result = startResetOperation(journal, 'archive-season-data', 'lease-a', 1300, journal.revision);
  assert.equal(result.changed, true);
  journal = result.journal;
  result = completeResetOperation(journal, 'archive-season-data', 'lease-a', 1400, journal.revision);
  assert.equal(result.changed, true);
  journal = result.journal;
  assert.equal(journal.operations[0].state, 'COMPLETED');
  assert.equal(journal.activeOperationId, null);
  assert.equal(journal.phase, 'READY');
});

test('expired lease safely returns an idempotent in-flight operation to pending', () => {
  let journal = claimedJournal();
  journal = startResetOperation(journal, 'archive-season-data', 'lease-a', 1200, journal.revision).journal;
  const recovered = recoverResetJournal(journal, 7000, journal.revision);
  assert.equal(recovered.changed, true);
  assert.equal(recovered.journal.lease, null);
  assert.equal(recovered.journal.activeOperationId, null);
  assert.equal(recovered.journal.operations[0].state, 'PENDING');
  assert.equal(recovered.journal.operations[0].lastErrorCode, 'WORKER_LEASE_EXPIRED');
  assert.equal(recovered.journal.recoveryRequired, false);
});

test('expired lease blocks a non-idempotent operation for manual reconciliation', () => {
  let journal = claimedJournal([]);
  journal = startResetOperation(journal, 'archive-season-data', 'lease-a', 1200, journal.revision).journal;
  const recovered = recoverResetJournal(journal, 7000, journal.revision);
  assert.equal(recovered.changed, true);
  assert.equal(recovered.reason, 'MANUAL_RECOVERY_REQUIRED');
  assert.equal(recovered.journal.operations[0].state, 'BLOCKED');
  assert.equal(recovered.journal.recoveryRequired, true);
  assert.equal(recovered.journal.lease, null);

  const claim = acquireResetLease(recovered.journal, 'worker-b', 'lease-b', 7100, 5000, recovered.journal.revision);
  assert.equal(claim.changed, false);
  assert.equal(claim.reason, 'RESET_NOT_CLAIMABLE');
});

test('failed operations are retried only when explicitly retryable and idempotent', () => {
  let journal = claimedJournal();
  journal = startResetOperation(journal, 'archive-season-data', 'lease-a', 1200, journal.revision).journal;
  const failed = failResetOperation(
    journal, 'archive-season-data', 'lease-a', 'TEMPORARY_STORAGE_ERROR', true, 1300, journal.revision,
  );
  assert.equal(failed.changed, true);
  assert.equal(failed.journal.operations[0].state, 'PENDING');
  assert.equal(failed.journal.operations[0].attempts, 1);
  assert.equal(failed.journal.recoveryRequired, false);
});

test('journal rejects invalid operation definitions and does not recover a live lease', () => {
  assert.throws(() => createResetJournal('reset', ['same', 'same'], 0), /RESET_OPERATION_IDS_INVALID/);
  assert.throws(() => createResetJournal('reset', ['one'], 0, ['unknown']), /RESET_IDEMPOTENCY_SCOPE_INVALID/);
  const journal = claimedJournal();
  const live = recoverResetJournal(journal, 1200, journal.revision);
  assert.equal(live.changed, false);
  assert.equal(live.reason, 'RESET_LEASE_NOT_EXPIRED');
});
