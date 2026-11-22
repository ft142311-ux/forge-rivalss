export type ResetOperationState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
export type ResetJournalPhase = 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

export type ResetOperation = {
  id: string;
  state: ResetOperationState;
  idempotent: boolean;
  attempts: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  lastErrorCode: string | null;
};

export type ResetLease = {
  ownerId: string;
  token: string;
  expiresAtMs: number;
};

export type ResetJournal = {
  schemaVersion: 1;
  resetId: string;
  phase: ResetJournalPhase;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
  lease: ResetLease | null;
  activeOperationId: string | null;
  operations: ResetOperation[];
  recoveryRequired: boolean;
};

export type JournalResult = {
  journal: ResetJournal;
  changed: boolean;
  reason?: string;
};

function cloneJournal(journal: ResetJournal): ResetJournal {
  return {
    ...journal,
    lease: journal.lease ? { ...journal.lease } : null,
    operations: journal.operations.map(operation => ({ ...operation })),
  };
}

function leaseIsValid(journal: ResetJournal, token: string, nowMs: number) {
  return Boolean(
    journal.lease &&
    journal.lease.token === token &&
    journal.lease.expiresAtMs > nowMs
  );
}

/** Creates a deterministic journal. Operation order is execution order. */
export function createResetJournal(
  resetId: string,
  operationIds: string[],
  nowMs: number,
  idempotentOperationIds: string[] = [],
): ResetJournal {
  if (!resetId.trim() || !Number.isFinite(nowMs) || operationIds.length === 0) {
    throw new Error('RESET_JOURNAL_INPUT_INVALID');
  }
  if (new Set(operationIds).size !== operationIds.length || operationIds.some(id => !id.trim())) {
    throw new Error('RESET_OPERATION_IDS_INVALID');
  }
  const idempotent = new Set(idempotentOperationIds);
  if ([...idempotent].some(id => !operationIds.includes(id))) {
    throw new Error('RESET_IDEMPOTENCY_SCOPE_INVALID');
  }
  return {
    schemaVersion: 1,
    resetId,
    phase: 'READY',
    revision: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    lease: null,
    activeOperationId: null,
    operations: operationIds.map(id => ({
      id,
      state: 'PENDING',
      idempotent: idempotent.has(id),
      attempts: 0,
      startedAtMs: null,
      completedAtMs: null,
      lastErrorCode: null,
    })),
    recoveryRequired: false,
  };
}

/**
 * Claims or renews the exclusive lease. The caller must persist the returned
 * journal inside a Firestore transaction with a revision compare-and-set.
 */
export function acquireResetLease(
  source: ResetJournal,
  ownerId: string,
  token: string,
  nowMs: number,
  leaseDurationMs: number,
  expectedRevision: number,
): JournalResult {
  const journal = cloneJournal(source);
  if (journal.revision !== expectedRevision) return { journal: source, changed: false, reason: 'REVISION_CONFLICT' };
  if (!ownerId.trim() || !token.trim() || leaseDurationMs <= 0 || !Number.isFinite(nowMs)) {
    return { journal: source, changed: false, reason: 'LEASE_INPUT_INVALID' };
  }
  if (journal.phase === 'COMPLETED' || journal.recoveryRequired) {
    return { journal: source, changed: false, reason: 'RESET_NOT_CLAIMABLE' };
  }
  if (journal.lease && journal.lease.expiresAtMs > nowMs && journal.lease.token !== token) {
    return { journal: source, changed: false, reason: 'RESET_LOCKED' };
  }
  if (journal.lease && journal.lease.token === token && journal.lease.ownerId !== ownerId) {
    return { journal: source, changed: false, reason: 'LEASE_OWNER_MISMATCH' };
  }
  journal.lease = { ownerId, token, expiresAtMs: nowMs + leaseDurationMs };
  journal.phase = journal.activeOperationId ? 'RUNNING' : 'READY';
  journal.updatedAtMs = nowMs;
  journal.revision += 1;
  return { journal, changed: true };
}

export function startResetOperation(
  source: ResetJournal,
  operationId: string,
  token: string,
  nowMs: number,
  expectedRevision: number,
): JournalResult {
  if (source.revision !== expectedRevision) return { journal: source, changed: false, reason: 'REVISION_CONFLICT' };
  if (!leaseIsValid(source, token, nowMs)) return { journal: source, changed: false, reason: 'RESET_LEASE_REQUIRED' };
  if (source.activeOperationId) return { journal: source, changed: false, reason: 'RESET_OPERATION_ALREADY_ACTIVE' };
  const journal = cloneJournal(source);
  const operation = journal.operations.find(item => item.id === operationId);
  if (!operation || operation.state !== 'PENDING') return { journal: source, changed: false, reason: 'RESET_OPERATION_NOT_PENDING' };
  const firstPending = journal.operations.find(item => item.state === 'PENDING');
  if (firstPending?.id !== operationId) return { journal: source, changed: false, reason: 'RESET_OPERATION_ORDER_INVALID' };
  operation.state = 'RUNNING';
  operation.attempts += 1;
  operation.startedAtMs = nowMs;
  operation.lastErrorCode = null;
  journal.activeOperationId = operationId;
  journal.phase = 'RUNNING';
  journal.updatedAtMs = nowMs;
  journal.revision += 1;
  return { journal, changed: true };
}

export function completeResetOperation(
  source: ResetJournal,
  operationId: string,
  token: string,
  nowMs: number,
  expectedRevision: number,
): JournalResult {
  if (source.revision !== expectedRevision) return { journal: source, changed: false, reason: 'REVISION_CONFLICT' };
  if (!leaseIsValid(source, token, nowMs)) return { journal: source, changed: false, reason: 'RESET_LEASE_REQUIRED' };
  if (source.activeOperationId !== operationId) return { journal: source, changed: false, reason: 'RESET_ACTIVE_OPERATION_MISMATCH' };
  const journal = cloneJournal(source);
  const operation = journal.operations.find(item => item.id === operationId);
  if (!operation || operation.state !== 'RUNNING') return { journal: source, changed: false, reason: 'RESET_OPERATION_NOT_RUNNING' };
  operation.state = 'COMPLETED';
  operation.completedAtMs = nowMs;
  journal.activeOperationId = null;
  const allCompleted = journal.operations.every(item => item.state === 'COMPLETED');
  journal.phase = allCompleted ? 'COMPLETED' : 'READY';
  if (allCompleted) journal.lease = null;
  journal.updatedAtMs = nowMs;
  journal.revision += 1;
  return { journal, changed: true };
}

export function failResetOperation(
  source: ResetJournal,
  operationId: string,
  token: string,
  errorCode: string,
  retryable: boolean,
  nowMs: number,
  expectedRevision: number,
): JournalResult {
  if (source.revision !== expectedRevision) return { journal: source, changed: false, reason: 'REVISION_CONFLICT' };
  if (!leaseIsValid(source, token, nowMs)) return { journal: source, changed: false, reason: 'RESET_LEASE_REQUIRED' };
  if (source.activeOperationId !== operationId) return { journal: source, changed: false, reason: 'RESET_ACTIVE_OPERATION_MISMATCH' };
  const journal = cloneJournal(source);
  const operation = journal.operations.find(item => item.id === operationId);
  if (!operation || operation.state !== 'RUNNING') return { journal: source, changed: false, reason: 'RESET_OPERATION_NOT_RUNNING' };
  const safeToRetry = retryable && operation.idempotent;
  operation.state = safeToRetry ? 'PENDING' : 'BLOCKED';
  operation.lastErrorCode = errorCode || 'RESET_OPERATION_FAILED';
  journal.activeOperationId = null;
  journal.recoveryRequired = !safeToRetry;
  journal.phase = safeToRetry ? 'PAUSED' : 'PAUSED';
  journal.updatedAtMs = nowMs;
  journal.revision += 1;
  return { journal, changed: true, reason: safeToRetry ? undefined : 'MANUAL_RECOVERY_REQUIRED' };
}

/**
 * Recovers an expired worker lease. A non-idempotent in-flight operation is
 * blocked for manual reconciliation; it is never blindly replayed.
 */
export function recoverResetJournal(
  source: ResetJournal,
  nowMs: number,
  expectedRevision: number,
): JournalResult {
  if (source.revision !== expectedRevision) return { journal: source, changed: false, reason: 'REVISION_CONFLICT' };
  if (!source.lease || source.lease.expiresAtMs > nowMs) return { journal: source, changed: false, reason: 'RESET_LEASE_NOT_EXPIRED' };
  const journal = cloneJournal(source);
  if (journal.activeOperationId) {
    const operation = journal.operations.find(item => item.id === journal.activeOperationId);
    if (!operation || operation.state !== 'RUNNING') {
      journal.recoveryRequired = true;
      journal.phase = 'PAUSED';
    } else if (operation.idempotent) {
      operation.state = 'PENDING';
      operation.startedAtMs = null;
      operation.lastErrorCode = 'WORKER_LEASE_EXPIRED';
      journal.phase = 'PAUSED';
    } else {
      operation.state = 'BLOCKED';
      operation.lastErrorCode = 'WORKER_LEASE_EXPIRED_NON_IDEMPOTENT';
      journal.recoveryRequired = true;
      journal.phase = 'PAUSED';
    }
    journal.activeOperationId = null;
  }
  journal.lease = null;
  journal.updatedAtMs = nowMs;
  journal.revision += 1;
  return { journal, changed: true, reason: journal.recoveryRequired ? 'MANUAL_RECOVERY_REQUIRED' : undefined };
}
