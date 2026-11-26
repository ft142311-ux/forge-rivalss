import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('player economy mutations are transactionally fenced during fresh Season 1 reset', () => {
  const cases = [
    ['../src/app/actions/economy.ts', 2],
    ['../src/app/actions/finances-server.ts', 1],
    ['../src/app/actions/player-care.ts', 1],
    ['../src/app/actions/player-lifecycle.ts', 1],
    ['../src/app/actions/shop.ts', 8],
    ['../src/app/actions/gameplay.ts', 6],
    ['../src/app/actions/p2-management.ts', 10],
    ['../src/app/actions/season-rollover.ts', 1],
    ['../src/app/actions/infrastructure.ts', 4],
    ['../src/app/actions/friendly-matchmaking.ts', 6],
    ['../src/app/actions/associations.ts', 8],
  ];

  for (const [path, expectedTransactions] of cases) {
    const source = read(path);
    const transactions = (source.match(/runTransaction\(async/g) || []).length;
    const fences = (source.match(/await assertStagingSeasonOneResetNotInProgress\(/g) || []).length;
    assert.equal(transactions, expectedTransactions, path + ' transaction count changed; review this fence test');
    assert.equal(fences, transactions, path + ' must fence every transaction');
    assert.match(source, /import \{ assertStagingSeasonOneResetNotInProgress \} from '@\/app\/lib\/staging-season-one-write-fence'/);
  }
});

test('shared player mutation fence reads season_config in the same transaction and fails closed', () => {
  const source = read('../src/app/lib/staging-season-one-write-fence.ts');
  assert.match(source, /tx\.get\(configRef\)/);
  assert.match(source, /stagingSeasonOneResetInProgress === true/);
  assert.match(source, /stagingFreshSeasonOneReset === true/);
  assert.match(source, /throw new Error\('STAGING_SEASON_ONE_RESET_IN_PROGRESS'\)/);
});

test('auction and match settlement writes honor both reset markers', () => {
  const cases = [
    ['../src/app/lib/auction-bid.ts', 2],
    ['../src/app/lib/auction-expiry-sweep.ts', 3],
    ['../src/app/actions/pro-market.ts', 2],
    ['../src/app/actions/match-economy.ts', 1],
  ];

  for (const [path, expectedGuards] of cases) {
    const source = read(path);
    const guards = (source.match(/stagingFreshSeasonOneReset === true/g) || []).length;
    assert.equal(guards, expectedGuards, path + ' must honor every Beta reset guard');
    assert.match(source, /stagingSeasonOneResetInProgress === true/);
  }
});
