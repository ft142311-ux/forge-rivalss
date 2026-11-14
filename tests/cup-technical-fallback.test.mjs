import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('cup technical fallback re-reads the match inside a transaction before writing', () => {
  const start = source.indexOf('async function finishTechnically');
  const end = source.indexOf('export async function runPyramidCupCycle', start);
  assert.ok(start >= 0 && end > start);
  const fallback = source.slice(start, end);
  assert.match(fallback, /db\.runTransaction\(async \(tx: any\) =>/);
  assert.match(fallback, /const snap = await tx\.get\(ref\)/);
  assert.match(fallback, /const terminal = existing\.isFinished === true/);
  assert.match(fallback, /\['finished', 'completed'\]\.includes\(String\(existing\.status \|\| ''\)\.toLowerCase\(\)\)/);
  assert.match(fallback, /if \(terminal && existing\.winnerId\) return true/);
  assert.match(fallback, /Completed cup knockout draw resolved by deterministic seed tie-break/);
  assert.match(fallback, /tx\.set\(ref, \{/);
  assert.doesNotMatch(fallback, /await ref\.set\(/);
});
