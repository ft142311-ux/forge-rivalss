import test from 'node:test';
import assert from 'node:assert/strict';
import { getArenaExpansionQuote, ARENA_BASE_CAPACITY, ARENA_MAX_EXPANSION } from '../src/app/lib/arena-expansion.ts';

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
