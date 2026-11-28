import { randomUUID } from 'node:crypto';

export const SEASON_ORCHESTRATOR_LOCK_ID = 'season_orchestrator_v1';
export const SEASON_ORCHESTRATOR_LOCK_TTL_MS = 15 * 60 * 1000;

type LockDb = {
  collection: (name: string) => { doc: (id: string) => any };
  runTransaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
};

export function isSeasonOrchestratorLockExpired(lock: any, nowMs = Date.now()) {
  return !lock || !Number.isFinite(Number(lock.expiresAtMs)) || Number(lock.expiresAtMs) <= nowMs;
}

/**
 * One global lease serializes the complete season scheduler entry point.
 * The 15-minute TTL is deliberately longer than the HTTP route's 300-second
 * execution ceiling, so a healthy request cannot be overtaken by the next tick.
 */
export async function acquireSeasonOrchestratorLock(
  db: LockDb,
  options: { nowMs?: number; ttlMs?: number; ownerId?: string; token?: string } = {},
) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? SEASON_ORCHESTRATOR_LOCK_TTL_MS);
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('SEASON_ORCHESTRATOR_LOCK_OPTIONS_INVALID');
  }
  const ownerId = options.ownerId || randomUUID();
  const ref = db.collection('system_v1').doc(SEASON_ORCHESTRATOR_LOCK_ID);

  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : null;
    const live = current && !isSeasonOrchestratorLockExpired(current, nowMs);
    const sameOwner = live && current.ownerId === ownerId &&
      Boolean(options.token) && current.token === options.token;
    if (live && !sameOwner) {
      return {
        acquired: false,
        lockOwnerId: String(current.ownerId || ''),
        expiresAtMs: Number(current.expiresAtMs),
      };
    }

    // Always issue a fresh fencing token after expiry, even if ownerId repeats.
    const token = sameOwner ? String(current.token) : randomUUID();
    const expiresAtMs = nowMs + ttlMs;
    tx.set(ref, { ownerId, token, acquiredAtMs: nowMs, expiresAtMs }, { merge: true });
    return { acquired: true, ownerId, token, expiresAtMs };
  });
}

/** Release only the exact live lease acquired by this invocation. */
export async function releaseSeasonOrchestratorLock(db: LockDb, ownerId: string, token: string) {
  const ref = db.collection('system_v1').doc(SEASON_ORCHESTRATOR_LOCK_ID);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : null;
    if (!current || current.ownerId !== ownerId || current.token !== token) {
      return { released: false };
    }
    tx.delete(ref);
    return { released: true };
  });
}
