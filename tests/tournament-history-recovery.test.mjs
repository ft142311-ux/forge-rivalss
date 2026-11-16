import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');

test('tournament finalization leaves a durable pending marker before participant history writes', () => {
  const finalStart = source.indexOf("if (stage === 'final')");
  const finalEnd = source.indexOf('\n  return false;', finalStart);
  assert.ok(finalStart >= 0 && finalEnd > finalStart);
  const finalizer = source.slice(finalStart, finalEnd);
  const pendingWrite = finalizer.indexOf("historySyncStatus: 'pending'");
  const syncCall = finalizer.indexOf('syncCompletedTournamentHistory(db, completedTournament)');
  assert.ok(pendingWrite >= 0);
  assert.ok(syncCall > pendingWrite);
});

test('completed tournament history sync is retried and finalized only after idempotent profile writes', () => {
  const helperStart = source.indexOf('async function syncCompletedTournamentHistory');
  const helperEnd = source.indexOf('async function advanceTournament', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /FieldValue\.arrayUnion\(/);
  assert.match(helper, /await Promise\.all\(updates\)/);
  assert.match(helper, /historySyncStatus: 'completed'/);

  const cycleStart = source.indexOf('export async function runTournamentCycle');
  const cycle = source.slice(cycleStart);
  assert.match(cycle, /where\('historySyncStatus', '==', 'pending'\)/);
  assert.match(cycle, /pendingTournament\.status !== 'completed'/);
  assert.match(cycle, /syncCompletedTournamentHistory\(db, pendingTournament\)/);
  assert.match(cycle, /historiesSynced/);
});

test('concurrent final-stage workers reuse one committed completion timestamp', () => {
  const finalStart = source.indexOf("if (stage === 'final')");
  const finalEnd = source.indexOf('\n  return false;', finalStart);
  const finalizer = source.slice(finalStart, finalEnd);
  assert.match(finalizer, /db\.runTransaction\(async \(t: any\) =>/);
  assert.match(finalizer, /current\.status === 'completed'/);
  assert.match(finalizer, /current\.historySyncStatus !== 'pending'/);
  assert.match(finalizer, /return \{ id: tournament\.id, \.\.\.current \}/);
  assert.match(finalizer, /const finishedAt = Date\.now\(\)/);
});
