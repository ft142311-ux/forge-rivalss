import test from 'node:test';
import assert from 'node:assert/strict';
import { runTwoPhaseSeasonOrchestration } from '../src/app/actions/season-orchestration.ts';

function fake({ before = { ready: true }, after = before, failRead = null, failPreflight = null } = {}) {
  const calls = [];
  let reads = 0;
  const deps = {
    readState: async phase => {
      calls.push(`read:${phase}`);
      if (failRead === phase) throw new Error(`READ_${phase}`);
      reads++;
      return { phase, groups: reads === 1 ? 15 : 15 };
    },
    preflight: async (_state, phase) => {
      calls.push(`preflight:${phase}`);
      if (failPreflight === phase) throw new Error(`PREFLIGHT_${phase}`);
      return phase === 'before-lock' ? before : after;
    },
    acquireLock: async () => {
      calls.push('acquire-lock');
      return { acquired: true, ownerId: 'fake-owner', token: 'fake-token' };
    },
    releaseLock: async () => { calls.push('release-lock'); },
    effects: Object.fromEntries([
      ['writeTables', async () => calls.push('writeTables')],
      ['createArchive', async () => calls.push('createArchive')],
      ['createAwards', async () => calls.push('createAwards')],
      ['createRolloverPlan', async () => calls.push('createRolloverPlan')],
      ['updateSeasonConfig', async () => calls.push('updateSeasonConfig')],
    ]),
  };
  return { calls, deps };
}

test('D1-G1 conflict stops before lock and every write effect', async () => {
  const { calls, deps } = fake({ before: { ready: false, reason: 'SEASON_STANDINGS_SLOTS_FIXTURE_CONFLICT', failedGroups: ['D1-G1'] } });
  const result = await runTwoPhaseSeasonOrchestration(deps);
  assert.equal(result.ready, false);
  assert.deepEqual(calls, ['read:before-lock', 'preflight:before-lock']);
  assert.equal(calls.some(call => call === 'acquire-lock' || call === 'release-lock' || call.startsWith('write') || call.startsWith('create') || call.startsWith('update')), false);
});

test('incomplete slots fail before lock and side effects', async () => {
  const { calls, deps } = fake({ before: { ready: false, reason: 'INCOMPLETE_SLOT_SET' } });
  await runTwoPhaseSeasonOrchestration(deps);
  assert.deepEqual(calls, ['read:before-lock', 'preflight:before-lock']);
});

test('a conflict appearing after lock is rejected before any write', async () => {
  const { calls, deps } = fake({ after: { ready: false, reason: 'SEASON_STANDINGS_SLOTS_FIXTURE_CONFLICT' } });
  const result = await runTwoPhaseSeasonOrchestration(deps);
  assert.equal(result.ready, false);
  assert.deepEqual(calls, [
    'read:before-lock', 'preflight:before-lock', 'acquire-lock',
    'read:after-lock', 'preflight:after-lock', 'release-lock',
  ]);
});

test('incomplete fixtures do not write tables, archive, awards, plan, or config', async () => {
  const { calls, deps } = fake({ before: { ready: false, reason: 'INCOMPLETE_OR_AMBIGUOUS_FIXTURES' } });
  await runTwoPhaseSeasonOrchestration(deps);
  assert.equal(calls.filter(call => /writeTables|createArchive|createAwards|createRolloverPlan|updateSeasonConfig/.test(call)).length, 0);
});

test('15 healthy groups reach the allowed fake-storage write boundary in order', async () => {
  const { calls, deps } = fake();
  const result = await runTwoPhaseSeasonOrchestration(deps);
  assert.equal(result.ready, true);
  assert.deepEqual(calls, [
    'read:before-lock', 'preflight:before-lock', 'acquire-lock',
    'read:after-lock', 'preflight:after-lock', 'writeTables',
    'createArchive', 'createAwards', 'createRolloverPlan',
    'updateSeasonConfig', 'release-lock',
  ]);
});

test('read and preflight errors happen before the fake commit boundary', async () => {
  for (const options of [{ failRead: 'before-lock' }, { failPreflight: 'before-lock' }, { failRead: 'after-lock' }, { failPreflight: 'after-lock' }]) {
    const { calls, deps } = fake(options);
    await assert.rejects(() => runTwoPhaseSeasonOrchestration(deps));
    assert.equal(calls.some(call => /writeTables|createArchive|createAwards|createRolloverPlan|updateSeasonConfig/.test(call)), false);
  }
});

test('an effect failure releases the acquired lock and does not run later effects', async () => {
  const calls = [];
  const result = await runTwoPhaseSeasonOrchestration({
    readState: async phase => { calls.push(`read:${phase}`); return { phase }; },
    preflight: async (_state, phase) => { calls.push(`preflight:${phase}`); return { ready: true }; },
    acquireLock: async state => { calls.push(`acquire:${state.phase}`); return { acquired: true, ownerId: 'owner', token: 'token' }; },
    releaseLock: async () => { calls.push('release'); },
    effects: {
      writeTables: async () => { calls.push('writeTables'); throw new Error('WRITE_FAILED'); },
      createArchive: async () => calls.push('createArchive'),
    },
  }).catch(error => error);
  assert.equal(result.message, 'WRITE_FAILED');
  assert.deepEqual(calls, [
    'read:before-lock', 'preflight:before-lock', 'acquire:before-lock',
    'read:after-lock', 'preflight:after-lock', 'writeTables', 'release',
  ]);
});
