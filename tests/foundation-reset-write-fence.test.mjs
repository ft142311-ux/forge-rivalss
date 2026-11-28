import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertStagingSeasonOneResetNotInProgress } from '../src/app/lib/staging-season-one-write-fence.ts';

const management = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');
const staff = readFileSync(new URL('../src/app/actions/foundation-staff.ts', import.meta.url), 'utf8');

function actionBlock(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `missing action ${name}`);
  const next = source.indexOf('export async function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('transactional reset fence rejects either Beta Season 1 reset marker', async () => {
  const db = { collection: name => ({ doc: id => ({ name, id }) }) };
  for (const marker of ['stagingSeasonOneResetInProgress', 'stagingFreshSeasonOneReset']) {
    const tx = { get: async () => ({ exists: true, data: () => ({ [marker]: true }) }) };
    await assert.rejects(
      assertStagingSeasonOneResetNotInProgress(tx, db),
      /STAGING_SEASON_ONE_RESET_IN_PROGRESS/,
    );
  }
  const clearTx = { get: async () => ({ exists: true, data: () => ({ stagingSeasonOneResetInProgress: false, stagingFreshSeasonOneReset: false }) }) };
  await assert.doesNotReject(assertStagingSeasonOneResetNotInProgress(clearTx, db));
  const missingTx = { get: async () => ({ exists: false, data: () => undefined }) };
  await assert.doesNotReject(assertStagingSeasonOneResetNotInProgress(missingTx, db));
});

test('every Foundation manager mutation is fenced before its first transaction write', () => {
  const actions = [
    'setFoundationTrainingFocusAction',
    'completePlayerTrainingAction',
    'recalculateTeamSynergyAction',
    'createFoundationTournamentAction',
    'registerFoundationTournamentAction',
    'recordFoundationTournamentResultAction',
    'joinAssociationFoundationAction',
    'changePlayerRoleAction',
    'getFoundationDailyEventAction',
    'associationTreasuryPaymentAction',
    'startFoundationTournamentAction',
  ];
  for (const name of actions) {
    const block = actionBlock(management, name);
    const fence = block.indexOf('assertStagingSeasonOneResetNotInProgress');
    const write = block.search(/\bt\.(?:update|set|create|delete)\s*\(/);
    assert.ok(fence >= 0, `${name} must read the reset fence`);
    assert.ok(write > fence, `${name} must check the reset fence before writing`);
    assert.match(block, /runTransaction\(/, `${name} must keep the fence and write in one transaction`);
  }
});

test('Foundation daily events and staff candidates are created atomically instead of read-then-create', () => {
  const daily = actionBlock(management, 'getFoundationDailyEventAction');
  const candidates = actionBlock(staff, 'getFoundationStaffCandidatesAction');
  assert.match(daily, /db\.runTransaction/);
  assert.match(daily, /t\.create\(ref/);
  assert.doesNotMatch(daily, /await ref\.create/);
  assert.match(candidates, /db\.runTransaction/);
  assert.match(candidates, /t\.create\(candidateRef/);
  assert.doesNotMatch(candidates, /await candidateRef\.set/);
  for (const name of ['getFoundationStaffCandidatesAction', 'hireFoundationStaffAction']) {
    const block = actionBlock(staff, name);
    const fence = block.indexOf('assertStagingSeasonOneResetNotInProgress');
    const write = block.search(/\bt\.(?:update|set|create|delete)\s*\(/);
    assert.ok(fence >= 0 && write > fence, `${name} must be fenced before writing`);
  }
});


test('daily event action keeps the event field present on both success and failure', () => {
  const daily = actionBlock(management, 'getFoundationDailyEventAction');
  assert.match(daily, /return \{ success: false, date: period, event: null, error: errorOf\(e\) \}/);
});
