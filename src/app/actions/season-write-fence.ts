/**
 * Storage-agnostic contract for the future season write-fence adapter.
 *
 * This module deliberately does not import Firebase.  A Firestore adapter must
 * mirror these checks inside the transaction that writes the first subject
 * document (and inside every later chunk transaction).
 */

/**
 * Immutable storage-issued revision identity. The producer must never reuse a
 * value after the canonical state changes; equality alone cannot detect an
 * external ABA that reuses the exact same string.
 */
export type CanonicalStateVersion = string;

export type SeasonWriteFenceLease = {
  ownerId: string;
  token: string;
  epoch: number;
  season: number;
  expectedCanonicalVersion: CanonicalStateVersion;
  acquiredAtMs: number;
  expiresAtMs: number;
};

export type AcquireSeasonWriteFenceInput = {
  ownerId: string;
  season: number;
  expectedCanonicalVersion: CanonicalStateVersion;
  nowMs: number;
  ttlMs: number;
};

export type AcquireSeasonWriteFenceResult =
  | { acquired: true; lease: SeasonWriteFenceLease }
  | { acquired: false; reason: 'LEASE_ACTIVE'; current: SeasonWriteFenceLease };

export type FenceCheckInput = {
  season: number;
  canonicalVersion: CanonicalStateVersion;
  nowMs: number;
};

export type FenceReleaseResult = { released: true } | { released: false; reason: 'NOT_CURRENT_OWNER' | 'LEASE_EXPIRED' };

export type FenceTokenFactory = () => string;

export class SeasonWriteFenceError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'TOKEN_REUSED'
    | 'FENCE_NOT_HELD'
    | 'FENCE_EXPIRED'
    | 'SEASON_CHANGED'
    | 'CANONICAL_VERSION_CHANGED'
    | 'EPOCH_EXHAUSTED';

  constructor(code: SeasonWriteFenceError['code']) {
    super(code);
    this.name = 'SeasonWriteFenceError';
    this.code = code;
  }
}

function assertPositiveInteger(value: number, code: 'INVALID_INPUT') {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SeasonWriteFenceError(code);
}

function assertNonNegativeInteger(value: number, code: 'INVALID_INPUT') {
  if (!Number.isSafeInteger(value) || value < 0) throw new SeasonWriteFenceError(code);
}

function cloneLease(lease: SeasonWriteFenceLease): SeasonWriteFenceLease {
  return { ...lease };
}

/**
 * In-memory reference implementation of the fence contract.
 *
 * `nowMs` is always supplied by the caller. The class never reads a wall
 * clock, which makes expiry and race scenarios deterministic in tests and
 * leaves clock authority with the eventual transaction adapter.
 */
export class SeasonWriteFence {
  private current: SeasonWriteFenceLease | null = null;
  private nextEpoch = 0;
  private readonly issuedTokens = new Set<string>();
  private readonly tokenFactory: FenceTokenFactory;

  constructor(tokenFactory: FenceTokenFactory) {
    this.tokenFactory = tokenFactory;
  }

  acquire(input: AcquireSeasonWriteFenceInput): AcquireSeasonWriteFenceResult {
    if (!input || typeof input !== 'object') throw new SeasonWriteFenceError('INVALID_INPUT');
    assertPositiveInteger(input.season, 'INVALID_INPUT');
    assertNonNegativeInteger(input.nowMs, 'INVALID_INPUT');
    assertPositiveInteger(input.ttlMs, 'INVALID_INPUT');
    if (typeof input.ownerId !== 'string' || !input.ownerId ||
        typeof input.expectedCanonicalVersion !== 'string' || !input.expectedCanonicalVersion) {
      throw new SeasonWriteFenceError('INVALID_INPUT');
    }

    if (this.current && input.nowMs < this.current.expiresAtMs) {
      return { acquired: false, reason: 'LEASE_ACTIVE', current: cloneLease(this.current) };
    }

    const token = this.tokenFactory();
    if (typeof token !== 'string' || !token) throw new SeasonWriteFenceError('INVALID_INPUT');
    if (this.issuedTokens.has(token)) throw new SeasonWriteFenceError('TOKEN_REUSED');
    if (this.nextEpoch >= Number.MAX_SAFE_INTEGER) throw new SeasonWriteFenceError('EPOCH_EXHAUSTED');
    const expiresAtMs = input.nowMs + input.ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) throw new SeasonWriteFenceError('INVALID_INPUT');
    this.issuedTokens.add(token);
    this.nextEpoch++;

    const lease: SeasonWriteFenceLease = {
      ownerId: input.ownerId,
      token,
      epoch: this.nextEpoch,
      season: input.season,
      expectedCanonicalVersion: input.expectedCanonicalVersion,
      acquiredAtMs: input.nowMs,
      expiresAtMs,
    };
    this.current = lease;
    return { acquired: true, lease: cloneLease(lease) };
  }

  assert(lease: SeasonWriteFenceLease, input: FenceCheckInput): true {
    if (!lease || typeof lease !== 'object' || !input || typeof input !== 'object') {
      throw new SeasonWriteFenceError('INVALID_INPUT');
    }
    assertPositiveInteger(input.season, 'INVALID_INPUT');
    assertNonNegativeInteger(input.nowMs, 'INVALID_INPUT');
    if (typeof input.canonicalVersion !== 'string' || !input.canonicalVersion) {
      throw new SeasonWriteFenceError('INVALID_INPUT');
    }
    const current = this.current;
    if (!current || current.epoch !== lease.epoch || current.ownerId !== lease.ownerId || current.token !== lease.token) {
      throw new SeasonWriteFenceError('FENCE_NOT_HELD');
    }
    if (input.nowMs >= current.expiresAtMs) throw new SeasonWriteFenceError('FENCE_EXPIRED');
    if (input.season !== current.season) throw new SeasonWriteFenceError('SEASON_CHANGED');
    if (input.canonicalVersion !== current.expectedCanonicalVersion) {
      throw new SeasonWriteFenceError('CANONICAL_VERSION_CHANGED');
    }
    return true;
  }

  renew(lease: SeasonWriteFenceLease, input: FenceCheckInput, ttlMs: number): SeasonWriteFenceLease {
    this.assert(lease, input);
    assertPositiveInteger(ttlMs, 'INVALID_INPUT');
    const expiresAtMs = input.nowMs + ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) throw new SeasonWriteFenceError('INVALID_INPUT');
    const renewed = { ...this.current!, expiresAtMs };
    this.current = renewed;
    return cloneLease(renewed);
  }

  release(lease: SeasonWriteFenceLease, nowMs: number): FenceReleaseResult {
    assertNonNegativeInteger(nowMs, 'INVALID_INPUT');
    const current = this.current;
    if (!current || current.epoch !== lease.epoch || current.ownerId !== lease.ownerId || current.token !== lease.token) {
      return { released: false, reason: 'NOT_CURRENT_OWNER' };
    }
    if (nowMs >= current.expiresAtMs) return { released: false, reason: 'LEASE_EXPIRED' };
    this.current = null;
    return { released: true };
  }

  /** Test/adapter inspection only; it does not grant write authority. */
  getCurrentLease(): SeasonWriteFenceLease | null {
    return this.current ? cloneLease(this.current) : null;
  }
}
