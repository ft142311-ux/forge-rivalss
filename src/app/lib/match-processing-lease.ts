/**
 * A processing claim without a valid start timestamp cannot prove that a
 * worker still owns a live lease. Treat it as stale so a new token can fence
 * the unknown/legacy worker and safely resume the match.
 */
export function isProcessingLeaseStale(input: {
  isProcessing?: unknown;
  startedAtMs: number;
  nowMs: number;
  leaseMs: number;
}): boolean {
  if (input.isProcessing !== true) return true;
  if (!Number.isFinite(input.startedAtMs) ||
      !Number.isFinite(input.nowMs) ||
      !Number.isFinite(input.leaseMs) ||
      input.leaseMs <= 0) {
    return true;
  }
  return input.nowMs - input.startedAtMs >= input.leaseMs;
}
