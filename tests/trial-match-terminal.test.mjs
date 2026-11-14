import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/trial-match-resolver.ts', import.meta.url), 'utf8');

test('trial match scheduler treats finished and completed as terminal in every worker phase', () => {
  assert.match(source, /function isTrialMatchTerminal\(match: any\): boolean/);
  assert.match(source, /\['finished', 'completed'\]\.includes\(String\(match\?\.status \|\| ''\)\.toLowerCase\(\)\)/);
  assert.match(source, /if \(isTrialMatchTerminal\(match\) \|\| !Number\.isFinite\(dueAt\)/);
  assert.match(source, /data\?\.isTrial !== true \|\| isTrialMatchTerminal\(data\) \|\| \(data\?\.isProcessing === true && !isTrialMatchProcessingLeaseStale\(data, Date\.now\(\)\)\)/);
  assert.match(source, /if \(isTrialMatchTerminal\(data\)\) return false/);
  assert.match(source, /!isTrialMatchTerminal\(data\) && data\?\.isProcessing === true/);
  assert.match(source, /const TRIAL_MATCH_PROCESSING_LEASE_MS = 5 \* 60 \* 1000/);
  assert.match(source, /const processingToken = randomUUID\(\)/);
  assert.match(source, /data\?\.processingToken !== processingToken/);
  assert.match(source, /data\?\.processingToken === processingToken/);
  assert.match(source, /isTrialMatchProcessingLeaseStale\(data, Date\.now\(\)\)/);
});
