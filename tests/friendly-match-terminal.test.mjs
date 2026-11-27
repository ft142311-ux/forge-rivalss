import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isMatchReportFinished } from '../src/app/lib/match-report-utils.ts';

const source = readFileSync(new URL('../src/app/actions/friendly-matchmaking.ts', import.meta.url), 'utf8');

test('friendly match terminal predicate delegates to shared finished/completed/resolved semantics', () => {
  assert.match(source, /import \{ isMatchReportFinished \} from '\@\/app\/lib\/match-report-utils'/);
  assert.match(source, /function isFriendlyMatchTerminal\(match: any\): boolean \{\s*return isMatchReportFinished\(match\);\s*\}/);
  assert.equal(isMatchReportFinished({ isFinished: false, status: 'resolved' }), true);
  assert.equal(isMatchReportFinished({ status: ' RESOLVED ' }), true);
});

test('friendly resolver checks terminal state inside its transaction before simulation', () => {
  const start = source.indexOf('async function resolveFriendlyMatchDocument');
  const end = source.indexOf('/**', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  const terminalIndex = resolver.indexOf('if (isFriendlyMatchTerminal(match))');
  const scheduledIndex = resolver.indexOf("if (match.status !== 'scheduled')");
  const simulationIndex = resolver.indexOf('const simulation = runMatchEngine');
  assert.ok(terminalIndex >= 0 && scheduledIndex > terminalIndex && simulationIndex > scheduledIndex);
  assert.match(resolver, /alreadyResolved: true/);
});

test('friendly entry points reuse the same terminal predicate before attempting resolution', () => {
  assert.match(source, /reportSnap\.exists && isFriendlyMatchTerminal\(reportSnap\.data\(\) \|\| \{\}\)/);
  assert.match(source, /if \(isFriendlyMatchTerminal\(match\)\) return \{ success: true, started: false, finished: true, matchId \}/);
  assert.match(source, /isFriendlyMatchTerminal\(match\) \|\| !scheduledAtMs/);
});
