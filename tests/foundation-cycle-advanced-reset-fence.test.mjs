import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cycle = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');
const advanced = readFileSync(new URL('../src/app/actions/foundation-advanced.ts', import.meta.url), 'utf8');

function exportedBlock(source, name) {
  const start = source.indexOf('export async function ' + name);
  assert.ok(start >= 0, 'missing action ' + name);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('daily salary cycle fences every manager transaction and exits before scanning during either reset', () => {
  const processStart = cycle.indexOf('async function processManager');
  const processEnd = cycle.indexOf('\nexport async function runFoundationDailyCycle', processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  const process = cycle.slice(processStart, processEnd);
  const fence = process.indexOf('assertStagingSeasonOneResetNotInProgress');
  const firstWrite = process.search(/\bt\.(?:update|set|create|delete)\s*\(/);
  assert.ok(fence >= 0 && firstWrite > fence);
  assert.match(process, /runTransaction/);

  const daily = exportedBlock(cycle, 'runFoundationDailyCycle');
  assert.match(daily, /doc\('season_config'\)/);
  assert.match(daily, /stagingSeasonOneResetInProgress/);
  assert.match(daily, /stagingFreshSeasonOneReset/);
  assert.match(daily, /if \(resetBlocked\) break/);
});

test('manual Foundation profile synchronization is fenced in the same transaction as its write', () => {
  const sync = exportedBlock(cycle, 'syncFoundationForManager');
  const fence = sync.indexOf('assertStagingSeasonOneResetNotInProgress');
  const write = sync.indexOf('t.update(ref');
  assert.ok(fence >= 0 && write > fence);
  assert.match(sync, /runTransaction/);
  assert.doesNotMatch(sync, /await ref\.update/);
});

test('Foundation event resolution and fan actions are transactionally reset-fenced', () => {
  for (const name of ['resolveFoundationEventAction', 'foundationFanAction']) {
    const block = exportedBlock(advanced, name);
    const fence = block.indexOf('assertStagingSeasonOneResetNotInProgress');
    const write = block.search(/\bt\.(?:update|set|create|delete)\s*\(/);
    assert.ok(fence >= 0 && write > fence, name + ' must fence before writing');
    assert.match(block, /runTransaction/);
  }
  assert.match(exportedBlock(advanced, 'resolveFoundationEventAction'), /INVALID_EVENT_CHOICE/);
});

test('Golden Player and Golden Jacket votes are one-per-user transactional creates behind the reset fence', () => {
  for (const name of ['castGoldenPlayerVoteAction', 'castGoldenJacketVoteAction']) {
    const block = exportedBlock(advanced, name);
    const fence = block.indexOf('assertStagingSeasonOneResetNotInProgress');
    const create = block.indexOf('t.create(voteRef');
    assert.ok(fence >= 0 && create > fence, name + ' must fence before creating the vote');
    assert.match(block, /voteSnap\.exists/);
    assert.match(block, /runTransaction/);
  }
});

test('Golden Player award publication is admin-only, global, immutable and reset-fenced', () => {
  const block = exportedBlock(advanced, 'resolveGoldenPlayerAwardAction');
  assert.match(block, /requireAdminActor/);
  assert.match(block, /collection\(FOUNDATION_COLLECTIONS\.managers\)\.get\(\)/);
  assert.match(block, /t\.create\(ref/);
  assert.match(block, /assertStagingSeasonOneResetNotInProgress/);
  assert.doesNotMatch(block, /ref\.set\(/);
  assert.match(block, /alreadyResolved/);
});
