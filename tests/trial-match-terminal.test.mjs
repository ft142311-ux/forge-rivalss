import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isProcessingLeaseStale } from '../src/app/lib/match-processing-lease.ts';
import { isMatchReportFinished } from '../src/app/lib/match-report-utils.ts';

const source = readFileSync(new URL('../src/app/actions/trial-match-resolver.ts', import.meta.url), 'utf8');

test('trial match scheduler delegates every worker phase to the shared terminal-state predicate', () => {
  assert.match(source, /import \{ isMatchReportFinished \} from '\@\/app\/lib\/match-report-utils'/);
  assert.match(source, /function isTrialMatchTerminal\(match: any\): boolean \{\s*return isMatchReportFinished\(match\);\s*\}/);
  assert.match(source, /if \(isTrialMatchTerminal\(match\) \|\| !Number\.isFinite\(dueAt\)/);
  assert.match(source, /data\?\.isTrial !== true \|\| isTrialMatchTerminal\(data\) \|\| \(data\?\.isProcessing === true && !isTrialMatchProcessingLeaseStale\(data, Date\.now\(\)\)\)/);
  assert.match(source, /if \(isTrialMatchTerminal\(data\)\) return false/);
  assert.match(source, /!isTrialMatchTerminal\(data\) && data\?\.isProcessing === true/);
  assert.match(source, /const TRIAL_MATCH_PROCESSING_LEASE_MS = 5 \* 60 \* 1000/);
  assert.match(source, /const processingToken = randomUUID\(\)/);
  assert.match(source, /data\?\.processingToken !== processingToken/);
  assert.match(source, /data\?\.processingToken === processingToken/);
  assert.match(source, /isTrialMatchProcessingLeaseStale\(data, Date\.now\(\)\)/);
  assert.equal(isMatchReportFinished({ isFinished: false, status: 'resolved' }), true);
  assert.equal(isMatchReportFinished({ status: ' RESOLVED ' }), true);
});

test('trial processing claims with missing or invalid timestamps are recoverable', () => {
  const nowMs = 10_000_000;
  const leaseMs = 5 * 60 * 1000;
  assert.equal(isProcessingLeaseStale({ isProcessing: true, startedAtMs: Number.NaN, nowMs, leaseMs }), true);
  assert.equal(isProcessingLeaseStale({ isProcessing: true, startedAtMs: 0, nowMs, leaseMs }), true);
  assert.equal(isProcessingLeaseStale({ isProcessing: true, startedAtMs: nowMs - leaseMs, nowMs, leaseMs }), true);
  assert.equal(isProcessingLeaseStale({ isProcessing: true, startedAtMs: nowMs - 1, nowMs, leaseMs }), false);
  assert.equal(isProcessingLeaseStale({ isProcessing: false, startedAtMs: nowMs, nowMs, leaseMs }), true);
  assert.equal(isProcessingLeaseStale({ isProcessing: true, startedAtMs: nowMs, nowMs, leaseMs: 0 }), true);
});

test('trial resolver delegates claim expiry to the shared processing lease policy', () => {
  assert.match(source, /isProcessingLeaseStale\(\{/);
  assert.match(source, /startedAtMs: timestampToMillis\(match\?\.processingStartedAt\)/);
});
