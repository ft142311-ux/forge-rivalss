import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/pro-market.ts', import.meta.url), 'utf8');

test('PRO daily lot rotation reads the Season 1 reset marker before mutating market_v7', () => {
  const start = source.indexOf('export async function ensureProMarketDailyDropAction');
  const end = source.indexOf('/** Places a bid', start);
  const action = source.slice(start, end);
  assert.match(action, /const resetConfigRef = db\.collection\('system_v1'\)\.doc\('season_config'\)/);
  assert.match(action, /tx\.get\(resetConfigRef\)/);
  assert.match(action, /stagingSeasonOneResetInProgress === true/);
  assert.match(action, /throw new Error\('STAGING_SEASON_ONE_RESET_IN_PROGRESS'\)/);
  assert.ok(action.indexOf('stagingSeasonOneResetInProgress === true') < action.indexOf('tx.delete(oldLot.ref)'));
  assert.ok(action.indexOf('stagingSeasonOneResetInProgress === true') < action.indexOf('tx.set(lotRef'));
});

test('youth player listing reads the Season 1 reset marker before reserving a player or creating a lot', () => {
  const start = source.indexOf('export async function listYouthPlayerOnMarketAction');
  const action = source.slice(start);
  assert.match(action, /tx\.get\(resetConfigRef\)/);
  assert.match(action, /stagingSeasonOneResetInProgress === true/);
  assert.match(action, /throw new Error\('STAGING_SEASON_ONE_RESET_IN_PROGRESS'\)/);
  assert.ok(action.indexOf('stagingSeasonOneResetInProgress === true') < action.indexOf('tx.create(marketRef'));
  assert.ok(action.indexOf('stagingSeasonOneResetInProgress === true') < action.indexOf('tx.update(profileRef'));
});
