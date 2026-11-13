import { randomUUID } from 'crypto';

export const SEASON_ROLLOVER_LOCK_ID = 'season_rollover_v1';
export const SEASON_ROLLOVER_LOCK_TTL_MS = 15 * 60 * 1000;
export const SEASON_CALENDAR_BUILD_LOCK_ID = 'season_calendar_build_v1';
export const SEASON_CALENDAR_BUILD_LOCK_TTL_MS = 15 * 60 * 1000;

type LockDb = {
  collection: (name: string) => { doc: (id: string) => any };
  runTransaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
};

type LeaseWrite = { ref: any; data: any; options?: any };

type PublicationExpectation = {
  sourceSeason: number;
  targetSeason: number;
  calendarRevision: number;
  phase: string;
  planRef?: any;
  validatePlan?: (plan: any) => boolean;
  publicationDeadlineMs: number;
  activationAtMs: number;
  allowOverdueRecovery?: boolean;
  activationEndAtMs?: number;
};

export function isSeasonRolloverLockStale(lock: any, nowMs: number) {
  return !lock || Number(lock.expiresAtMs || 0) <= nowMs;
}

async function acquireLease(
  db: LockDb,
  lockId: string,
  sourceSeason: number,
  targetSeason: number,
  options: { ownerId?: string; token?: string; nowMs?: number; ttlMs?: number } = {},
) {
  const ownerId = options.ownerId || randomUUID();
  const nowMs = Number(options.nowMs ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? SEASON_ROLLOVER_LOCK_TTL_MS);
  const ref = db.collection('system_v1').doc(lockId);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : null;
    const ownedByCaller = current?.ownerId === ownerId && (!options.token || current?.token === options.token);
    if (current && !ownedByCaller && !isSeasonRolloverLockStale(current, nowMs)) {
      return { acquired: false, ownerId, lockOwnerId: String(current.ownerId || ''), expiresAtMs: Number(current.expiresAtMs || 0) };
    }
    const token = ownedByCaller ? String(current.token) : randomUUID();
    tx.set(ref, { ownerId, token, sourceSeason, targetSeason, acquiredAtMs: nowMs, expiresAtMs: nowMs + ttlMs }, { merge: true });
    return { acquired: true, ownerId, token, expiresAtMs: nowMs + ttlMs };
  });
}

export async function acquireSeasonRolloverLock(
  db: LockDb,
  sourceSeason: number,
  targetSeason: number,
  options: { ownerId?: string; nowMs?: number; ttlMs?: number } = {},
) {
  return acquireLease(db, SEASON_ROLLOVER_LOCK_ID, sourceSeason, targetSeason, options);
}

async function releaseLease(db: LockDb, lockId: string, ownerId: string, token?: string) {
  const ref = db.collection('system_v1').doc(lockId);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : null;
    if (!current || current.ownerId !== ownerId || (token && current.token !== token)) return { released: false };
    tx.delete(ref);
    return { released: true };
  });
}

export async function releaseSeasonRolloverLock(db: LockDb, ownerId: string, token?: string) {
  return releaseLease(db, SEASON_ROLLOVER_LOCK_ID, ownerId, token);
}

async function assertLease(
  db: LockDb,
  lockId: string,
  ownerId: string,
  token: string,
  nowMs: number,
  lostError: string,
) {
  const ref = db.collection('system_v1').doc(lockId);
  const snap = await ref.get();
  const current = snap.exists ? snap.data() || {} : null;
  if (!current || current.ownerId !== ownerId || current.token !== token || isSeasonRolloverLockStale(current, nowMs)) {
    throw new Error(lostError);
  }
  return true;
}

export async function assertSeasonRolloverLock(db: LockDb, ownerId: string, token: string, nowMs = Date.now()) {
  return assertLease(db, SEASON_ROLLOVER_LOCK_ID, ownerId, token, nowMs, 'SEASON_ROLLOVER_LOCK_LOST');
}

/** Extend an unexpired lease transactionally. An expired owner cannot resurrect its lease. */
export async function renewSeasonRolloverLock(
  db: LockDb,
  ownerId: string,
  token: string,
  options: { nowMs?: number; ttlMs?: number } = {},
) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? SEASON_ROLLOVER_LOCK_TTL_MS);
  const ref = db.collection('system_v1').doc(SEASON_ROLLOVER_LOCK_ID);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : null;
    if (!current || current.ownerId !== ownerId || current.token !== token || isSeasonRolloverLockStale(current, nowMs)) {
      throw new Error('SEASON_ROLLOVER_LOCK_LOST');
    }
    const expiresAtMs = nowMs + ttlMs;
    tx.set(ref, { expiresAtMs, renewedAtMs: nowMs }, { merge: true });
    return { renewed: true, expiresAtMs };
  });
}

/**
 * Apply a bounded write chunk only while the caller still owns the live lease.
 * The lease check and writes share one Firestore transaction, fencing expired owners.
 */
export async function commitSeasonRolloverWrites(db: LockDb, ownerId: string, token: string, writes: LeaseWrite[]) {
  if (writes.length === 0) return;
  if (writes.length > 450) throw new Error('SEASON_ROLLOVER_WRITE_CHUNK_TOO_LARGE');
  const lockRef = db.collection('system_v1').doc(SEASON_ROLLOVER_LOCK_ID);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(lockRef);
    const current = snap.exists ? snap.data() || {} : null;
    const nowMs = Date.now();
    if (!current || current.ownerId !== ownerId || current.token !== token || isSeasonRolloverLockStale(current, nowMs)) {
      throw new Error('SEASON_ROLLOVER_LOCK_LOST');
    }
    tx.set(lockRef, { expiresAtMs: nowMs + SEASON_ROLLOVER_LOCK_TTL_MS, renewedAtMs: nowMs }, { merge: true });
    for (const write of writes) tx.set(write.ref, write.data, write.options);
  });
}

export async function acquireSeasonCalendarBuildLock(db: LockDb, sourceSeason: number, targetSeason: number, options: { ownerId?: string; token?: string; nowMs?: number; ttlMs?: number } = {}) {
  return acquireLease(db, SEASON_CALENDAR_BUILD_LOCK_ID, sourceSeason, targetSeason, { ...options, ttlMs: options.ttlMs ?? SEASON_CALENDAR_BUILD_LOCK_TTL_MS });
}

export async function assertSeasonCalendarBuildLock(db: LockDb, ownerId: string, token: string, nowMs = Date.now()) {
  return assertLease(db, SEASON_CALENDAR_BUILD_LOCK_ID, ownerId, token, nowMs, 'SEASON_CALENDAR_BUILD_LOCK_LOST');
}

/** Read the lease and apply one <=450-write chunk in the same transaction. */
export async function commitSeasonCalendarWrites(db: LockDb, ownerId: string, token: string, writes: LeaseWrite[]) {
  if (writes.length === 0) return;
  if (writes.length > 450) throw new Error('SEASON_CALENDAR_WRITE_CHUNK_TOO_LARGE');
  const ref = db.collection('system_v1').doc(SEASON_CALENDAR_BUILD_LOCK_ID);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() || {} : null;
    const nowMs = Date.now();
    if (!current || current.ownerId !== ownerId || current.token !== token || isSeasonRolloverLockStale(current, nowMs)) {
      throw new Error('SEASON_CALENDAR_BUILD_LOCK_LOST');
    }
    // Calendar generation may span many bounded write chunks. Renew the lease
    // in the same transaction as each chunk so a live builder cannot be replaced
    // while it is still committing work.
    tx.set(ref, { expiresAtMs: nowMs + SEASON_CALENDAR_BUILD_LOCK_TTL_MS, renewedAtMs: nowMs }, { merge: true });
    for (const write of writes) tx.set(write.ref, write.data, write.options);
  });
}

/**
 * Atomically publish a prepared season. Both the lock and season_config are
 * read in this transaction before the publication write, so a concurrent
 * config update causes a retry/conflict instead of a last-write-wins publish.
 */
export async function commitSeasonCalendarPublication(
  db: LockDb,
  ownerId: string,
  token: string,
  expected: PublicationExpectation,
  write: LeaseWrite,
) {
  const lockRef = db.collection('system_v1').doc(SEASON_CALENDAR_BUILD_LOCK_ID);
  const configRef = db.collection('system_v1').doc('season_config');
  return db.runTransaction(async (tx: any) => {
    const lockSnap = await tx.get(lockRef);
    const configSnap = await tx.get(configRef);
    const planSnap = expected.planRef ? await tx.get(expected.planRef) : null;
    const lock = lockSnap.exists ? lockSnap.data() || {} : null;
    const config = configSnap.exists ? configSnap.data() || {} : null;
    if (!lock || lock.ownerId !== ownerId || lock.token !== token || isSeasonRolloverLockStale(lock, Date.now())) {
      throw new Error('SEASON_CALENDAR_BUILD_LOCK_LOST');
    }
    if (!config ||
        Number(config.activeSeasonNumber || 1) !== expected.sourceSeason ||
        Number(config.nextSeasonNumber || 0) !== expected.targetSeason ||
        Number(config.preparationTargetSeason || 0) !== expected.targetSeason ||
        config.worldReady !== true ||
        config.preparedWorldReady !== true ||
        Number(config.preparedSeasonNumber || 0) !== expected.targetSeason ||
        Number(config.preparedCalendarRevision || 0) !== expected.calendarRevision ||
        String(config.phase || '') !== expected.phase) {
      throw new Error('SEASON_CALENDAR_PUBLICATION_STATE_CHANGED');
    }
    const nowMs = Date.now();
    if (expected.allowOverdueRecovery === true) {
      if (nowMs < expected.activationAtMs || !Number.isFinite(Number(expected.activationEndAtMs)) ||
          nowMs >= Number(expected.activationEndAtMs)) {
        throw new Error('SEASON_CALENDAR_PUBLICATION_WINDOW_CLOSED');
      }
    } else if (nowMs > expected.publicationDeadlineMs || nowMs >= expected.activationAtMs) {
      throw new Error('SEASON_CALENDAR_PUBLICATION_WINDOW_CLOSED');
    }
    if (expected.planRef && (!planSnap?.exists || !expected.validatePlan?.(planSnap.data() || {}))) {
      throw new Error('SEASON_CALENDAR_PUBLICATION_PLAN_CHANGED');
    }
    tx.set(write.ref, write.data, write.options);
    return { committed: true };
  });
}

export async function releaseSeasonCalendarBuildLock(db: LockDb, ownerId: string, token: string) {
  return releaseLease(db, SEASON_CALENDAR_BUILD_LOCK_ID, ownerId, token);
}
