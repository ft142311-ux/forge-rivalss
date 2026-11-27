import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const source = readFileSync(new URL('../src/app/actions/pro-market.ts', import.meta.url), 'utf8');

test('PRO daily lot rotation reads the Season 1 reset marker before mutating market_v7', () => {
  const start = source.indexOf('export async function ensureProMarketDailyDropAction');
  const end = source.indexOf('/** Places a bid', start);
  const action = source.slice(start, end);
  assert.match(action, /const resetConfigRef = db\.collection\('system_v1'\)\.doc\('season_config'\)/);
  assert.match(action, /tx\.get\(resetConfigRef\)/);
  assert.match(action, /stagingSeasonOneResetInProgress === true/);
  assert.match(action, /stagingFreshSeasonOneReset === true/);
  assert.match(action, /throw new Error\('STAGING_SEASON_ONE_RESET_IN_PROGRESS'\)/);
  assert.ok(action.indexOf('stagingSeasonOneResetInProgress === true') < action.indexOf('tx.delete(oldLot.ref)'));
  assert.ok(action.indexOf('stagingSeasonOneResetInProgress === true') < action.indexOf('tx.set(lotRef'));
});

test('youth player listing delegates to a transactionally fenced atomic listing helper', () => {
  const actionStart = source.indexOf('export async function listYouthPlayerOnMarketAction');
  const action = source.slice(actionStart);
  assert.match(source, /import \{ createYouthMarketListingWithDb \} from '\@\/app\/lib\/market-listing'/);
  assert.match(action, /createYouthMarketListingWithDb\(getAdminDb\(\), uid, playerId\)/);

  const listing = read('../src/app/lib/market-listing.ts');
  const start = listing.indexOf('export async function createYouthMarketListingWithDb');
  const block = listing.slice(start);
  const fence = block.indexOf('await assertStagingSeasonOneResetNotInProgress(tx, db)');
  assert.ok(fence >= 0);
  assert.ok(fence < block.indexOf('tx.create(marketRef'));
  assert.ok(fence < block.indexOf('tx.update(profileRef'));
});
