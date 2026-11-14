import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/trial-match-resolver.ts', import.meta.url), 'utf8');

test('trial match scheduler treats finished and completed as terminal in every worker phase', () => {
  assert.match(source, /function isTrialMatchTerminal\(match: any\): boolean/);
  assert.match(source, /\['finished', 'completed'\]\.includes\(String\(match\?\.status \|\| ''\)\.toLowerCase\(\)\)/);
  assert.match(source, /if \(isTrialMatchTerminal\(match\) \|\| !Number\.isFinite\(dueAt\)/);
  assert.match(source, /data\?\.isTrial !== true \|\| isTrialMatchTerminal\(data\) \|\| data\?\.isProcessing === true/);
  assert.match(source, /if \(isTrialMatchTerminal\(data\)\) return false/);
  assert.match(source, /!isTrialMatchTerminal\(data\) && data\?\.isProcessing === true/);
});
