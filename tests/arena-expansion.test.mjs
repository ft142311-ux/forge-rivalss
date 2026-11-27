import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getArenaExpansionQuote, ARENA_BASE_CAPACITY, ARENA_MIN_SUPPORTED_CAPACITY, ARENA_MAX_EXPANSION } from '../src/app/lib/arena-expansion.ts';

test('new club arena capacity uses the canonical 5,000-seat baseline across registration and game defaults', () => {
  assert.equal(ARENA_BASE_CAPACITY, 5000);
  const registration = readFileSync(new URL('../functions/registration-core.js', import.meta.url), 'utf8');
  const infrastructure = readFileSync(new URL('../src/app/actions/infrastructure.ts', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/app/lib/store.tsx', import.meta.url), 'utf8');
  const matchEconomy = readFileSync(new URL('../src/app/actions/match-economy.ts', import.meta.url), 'utf8');
  assert.match(registration, /DEFAULT_ARENA_CAPACITY = 5000/);
  assert.match(infrastructure, /arena\.capacity \?\? ARENA_BASE_CAPACITY/);
  assert.match(store, /arena: \{ capacity: ARENA_BASE_CAPACITY \}/);
  assert.match(matchEconomy, /n\(home\?\.arena\?\.capacity, ARENA_BASE_CAPACITY\)/);
});

test('legacy 3,000-seat clubs remain expandable without an implicit migration', () => {
  assert.equal(ARENA_MIN_SUPPORTED_CAPACITY, 3000);
  assert.equal(getArenaExpansionQuote(500, 3000).targetCapacity, 3500);
});

test('arena expansion preserves the approved first five price and time points', () => {
  const expected = [
    [500, 125000, 6],
    [1000, 250000, 12],
    [1500, 375000, 18],
    [2000, 500000, 24],
    [2500, 687500, 34],
  ];
  for (const [seats, cost, hours] of expected) {
    const quote = getArenaExpansionQuote(seats);
    assert.equal(quote.cost, cost);
    assert.equal(quote.durationHours, hours);
    assert.equal(quote.targetCapacity, ARENA_BASE_CAPACITY + seats);
  }
});

test('50,000-seat expansion matches the approved maximum price and duration', () => {
  const quote = getArenaExpansionQuote(ARENA_MAX_EXPANSION);
  assert.equal(quote.cost, 183926000);
  assert.equal(quote.durationHours, 2640);
  assert.equal(quote.durationMs, 110 * 24 * 60 * 60 * 1000);
});

test('extended duration schedule preserves the published intermediate checkpoints', () => {
  const expected = [
    [3000, 44],
    [3500, 54],
    [5000, 85],
    [10000, 200],
    [25000, 719],
    [50000, 2640],
  ];
  for (const [seats, hours] of expected) {
    assert.equal(getArenaExpansionQuote(seats).durationHours, hours);
  }
});

test('larger expansions have strictly increasing price and duration', () => {
  let previous = getArenaExpansionQuote(500);
  for (let seats = 1000; seats <= ARENA_MAX_EXPANSION; seats += 500) {
    const current = getArenaExpansionQuote(seats);
    assert.ok(current.cost > previous.cost, `price must rise at ${seats}`);
    assert.ok(current.durationHours > previous.durationHours, `duration must rise at ${seats}`);
    previous = current;
  }
});

test('expansion size and current capacity are validated', () => {
  for (const seats of [0, 100, 501, 50500, 50001, 1.5]) {
    assert.throws(() => getArenaExpansionQuote(seats), /INVALID_ARENA_EXPANSION_SIZE/);
  }
  assert.throws(() => getArenaExpansionQuote(500, 2500), /INVALID_ARENA_CAPACITY/);
});
