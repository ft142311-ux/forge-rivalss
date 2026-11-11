import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAtMostOneSeasonBoundary } from '../src/app/actions/season-boundary.ts';

test('a delayed scheduler advances only one season boundary per invocation', () => {
  const result = advanceAtMostOneSeasonBoundary(
    1,
    new Date('2026-09-21T15:00:00.000Z'),
    new Date('2026-10-08T15:00:00.000Z'),
    new Date('2026-10-25T15:00:00.000Z'),
    15,
  );
  assert.equal(result.seasonNumber, 2);
  assert.equal(result.seasonStart.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(result.nextBoundary.toISOString(), '2026-10-23T15:00:00.000Z');
  assert.equal(result.advanced, true);
});

test('a future boundary does not advance the active season', () => {
  const result = advanceAtMostOneSeasonBoundary(
    2,
    new Date('2026-10-08T15:00:00.000Z'),
    new Date('2026-10-23T15:00:00.000Z'),
    new Date('2026-10-20T15:00:00.000Z'),
    15,
  );
  assert.equal(result.seasonNumber, 2);
  assert.equal(result.advanced, false);
});

test('invalid season boundary inputs fail closed', () => {
  assert.throws(() => advanceAtMostOneSeasonBoundary(0, new Date(), new Date(), new Date(), 15), /INVALID_SEASON_BOUNDARY_INPUT/);
});


test('a stale target cannot skip the immediate next season', async () => {
  const { resolveNextSeasonTarget } = await import('../src/app/actions/season-boundary.ts');
  assert.equal(resolveNextSeasonTarget(1, 3), 2);
  assert.equal(resolveNextSeasonTarget(2, 9), 3);
});

test('invalid active season is rejected when resolving a target', async () => {
  const { resolveNextSeasonTarget } = await import('../src/app/actions/season-boundary.ts');
  assert.throws(() => resolveNextSeasonTarget(0, 2), /INVALID_ACTIVE_SEASON_NUMBER/);
});
