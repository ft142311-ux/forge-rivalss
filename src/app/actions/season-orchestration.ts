/**
 * Small, storage-agnostic orchestration guard used by season actions.
 *
 * It deliberately knows nothing about standings, calendar construction, or
 * Firebase.  Those concerns stay in the injected dependencies so this layer
 * can be tested with a call journal and no real database.
 */
export type OrchestrationPreflight = { ready: boolean; [key: string]: unknown };

export type TwoPhaseOrchestrationDeps<TState, TLock, TResult> = {
  readState: (phase: 'before-lock' | 'after-lock') => Promise<TState>;
  preflight: (state: TState, phase: 'before-lock' | 'after-lock') => Promise<OrchestrationPreflight> | OrchestrationPreflight;
  acquireLock: (state: TState) => Promise<TLock & { acquired: boolean; expiresAtMs?: number }>;
  releaseLock: (lock: TLock & { acquired: boolean }) => Promise<void>;
  /** Optional named effect dependencies make the write boundary observable in tests. */
  effects?: {
    writeTables?: (state: TState, lock: TLock & { acquired: boolean }) => Promise<void>;
    createArchive?: (state: TState, lock: TLock & { acquired: boolean }) => Promise<void>;
    createAwards?: (state: TState, lock: TLock & { acquired: boolean }) => Promise<void>;
    createRolloverPlan?: (state: TState, lock: TLock & { acquired: boolean }) => Promise<void>;
    updateSeasonConfig?: (state: TState, lock: TLock & { acquired: boolean }) => Promise<void>;
  };
  commit?: (state: TState, lock: TLock & { acquired: boolean }) => Promise<TResult>;
  onPreflightFailure?: (state: TState, phase: 'before-lock' | 'after-lock', result: OrchestrationPreflight) => TResult | Promise<TResult>;
  onLockUnavailable?: (lock: TLock & { acquired: boolean }) => TResult | Promise<TResult>;
};

/**
 * Run a read-only preflight, acquire a lease, repeat the read-only preflight,
 * and only then enter the injected commit phase.  The second preflight is the
 * race barrier: state changed between the first check and lock acquisition
 * cannot reach a write dependency.
 */
export async function runTwoPhaseSeasonOrchestration<TState, TLock extends { acquired: boolean }, TResult>(
  deps: TwoPhaseOrchestrationDeps<TState, TLock, TResult>,
): Promise<TResult | OrchestrationPreflight> {
  const beforeState = await deps.readState('before-lock');
  const before = await deps.preflight(beforeState, 'before-lock');
  if (!before.ready) {
    return deps.onPreflightFailure
      ? deps.onPreflightFailure(beforeState, 'before-lock', before)
      : { ...before, writesStarted: false };
  }

  const lock = await deps.acquireLock(beforeState);
  if (!lock.acquired) {
    return deps.onLockUnavailable
      ? deps.onLockUnavailable(lock)
      : { ready: false, reason: 'LOCK_UNAVAILABLE', lockExpiresAtMs: lock.expiresAtMs, writesStarted: false };
  }

  try {
    const afterState = await deps.readState('after-lock');
    const after = await deps.preflight(afterState, 'after-lock');
    if (!after.ready) {
      return deps.onPreflightFailure
        ? deps.onPreflightFailure(afterState, 'after-lock', after)
        : { ...after, writesStarted: false };
    }
    for (const effect of [
      deps.effects?.writeTables,
      deps.effects?.createArchive,
      deps.effects?.createAwards,
      deps.effects?.createRolloverPlan,
      deps.effects?.updateSeasonConfig,
    ]) {
      if (effect) await effect(afterState, lock);
    }
    return deps.commit ? await deps.commit(afterState, lock) : ({ ready: true, writesStarted: true } as TResult);
  } finally {
    await deps.releaseLock(lock);
  }
}
