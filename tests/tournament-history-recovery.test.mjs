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
  const participantSyncStart = source.indexOf('async function syncTournamentHistoryForParticipant');
  const participantSyncEnd = source.indexOf('async function syncCompletedTournamentHistory', participantSyncStart);
  assert.ok(participantSyncStart >= 0 && participantSyncEnd > participantSyncStart);
  const participantSync = source.slice(participantSyncStart, participantSyncEnd);
  assert.match(participantSync, /FieldValue\\.arrayUnion\\(/);
  assert.match(participantSync, /inactive_clubs_v1/);
  assert.match(participantSync, /clubSnapshot\.tournamentHistory/);
  assert.match(participantSync, /TOURNAMENT_HISTORY_PROFILE_MISSING/);
  assert.match(participantSync, /db\.runTransaction\(async \(t: any\) =>/);

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

test('stage transitions are transactionally fenced against stale concurrent workers', () => {
  const helperStart = source.indexOf('async function commitTournamentStageTransition');
  const helperEnd = source.indexOf('async function advanceTournament', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /db\.runTransaction\(async \(t: any\) =>/);
  assert.match(helper, /current\.stage !== expectedStage/);
  assert.match(helper, /!\['groups', 'active'\]\.includes\(String\(current\.status\)\)/);
  assert.match(helper, /TOURNAMENT_STAGE_FIXTURE_CONFLICT/);
  assert.match(helper, /t\.create\(fixtureRefs\[index\]/);
  assert.match(helper, /t\.update\(tournamentRef/);
  assert.doesNotMatch(helper, /batch\.set/);
});

test('group and knockout advancement both use the same fenced transition commit', () => {
  const advanceStart = source.indexOf('async function advanceTournament');
  const advanceEnd = source.indexOf('export async function runTournamentCycle', advanceStart);
  const advance = source.slice(advanceStart, advanceEnd);
  const calls = advance.match(/commitTournamentStageTransition\(db, tournament\.id, stage, nextStage, fixtures\)/g) || [];
  assert.equal(calls.length, 2);
});

test('interrupted tournament initialization is reclaimed only after its lease expires', () => {
  const initStart = source.indexOf('async function initializeTournament');
  const initEnd = source.indexOf('async function participantSnapshot', initStart);
  assert.ok(initStart >= 0 && initEnd > initStart);
  const initializer = source.slice(initStart, initEnd);
  assert.match(initializer, /data\.status === 'initializing'/);
  assert.match(initializer, /isTournamentMatchLeaseExpired\(data\.initializingAt, now, TOURNAMENT_MATCH_LEASE_MS\)/);
  assert.match(initializer, /initializationToken/);
  assert.match(initializer, /current\.initializationToken !== initializationToken/);
  assert.match(initializer, /TOURNAMENT_INITIALIZATION_LEASE_LOST/);
  assert.match(initializer, /t\.create\(ref\.collection\('participants'\)/);
  assert.match(initializer, /t\.create\(ref\.collection\('groups'\)/);
  assert.match(initializer, /t\.create\(ref\.collection\('matches'\)/);
  assert.match(initializer, /initializationToken: FieldValue\.delete\(\)/);
  assert.match(initializer, /initializingAt: FieldValue\.delete\(\)/);
});

test('tournament cron revisits initializing tournaments for lease recovery', () => {
  assert.match(source, /where\('status', 'in', \['registration', 'initializing', 'groups', 'active'\]\)/);
  assert.match(source, /tournament\.status === 'initializing'/);
  const initStart = source.indexOf('async function initializeTournament');
  const initEnd = source.indexOf('async function participantSnapshot', initStart);
  const initializer = source.slice(initStart, initEnd);
  assert.match(initializer, /current\.status !== 'initializing'/);
  assert.match(initializer, /current\.initializationToken !== initializationToken/);
});

test('legacy initializing records without an ownership token can be recovered safely', () => {
  const initStart = source.indexOf('async function initializeTournament');
  const initEnd = source.indexOf('async function participantSnapshot', initStart);
  const initializer = source.slice(initStart, initEnd);
  assert.match(initializer, /typeof data\.initializationToken === 'string'/);
  assert.match(initializer, /!hasInitializationOwner/);
  assert.match(initializer, /isTournamentMatchLeaseExpired\(data\.initializingAt, now, TOURNAMENT_MATCH_LEASE_MS\)/);
  assert.match(initializer, /initializationToken,/);
});
