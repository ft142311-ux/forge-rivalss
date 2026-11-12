import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAtMostOneSeasonBoundary, resolveSeasonLifecycleWindow } from '../src/app/actions/season-boundary.ts';

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

test('S1 keeps the historical Oct 8 activation while publication is due at 16:00 MSK on offseason day', () => {
  const start = new Date('2026-09-21T15:00:00.000Z');
  const next = new Date('2026-10-08T15:00:00.000Z');
  const beforeOffseason = resolveSeasonLifecycleWindow({ seasonStart: start, nextSeasonStart: next, now: new Date('2026-10-05T14:59:59.999Z') });
  assert.equal(beforeOffseason.leagueMatchesPaused, false);

  const offseason = resolveSeasonLifecycleWindow({ seasonStart: start, nextSeasonStart: next, now: new Date('2026-10-05T15:00:00.000Z') });
  assert.equal(offseason.offseasonActive, true);
  assert.equal(offseason.offseasonStartAt.toISOString(), '2026-10-05T15:00:00.000Z');
  assert.equal(offseason.publicationDeadlineAt.toISOString(), '2026-10-06T13:00:00.000Z');
  assert.equal(offseason.activationAt.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(offseason.leagueMatchesPaused, true);

  const atDeadline = resolveSeasonLifecycleWindow({ seasonStart: start, nextSeasonStart: next, now: new Date('2026-10-06T13:00:00.000Z') });
  assert.equal(atDeadline.publicationDeadlinePassed, false);
  const afterDeadline = resolveSeasonLifecycleWindow({ seasonStart: start, nextSeasonStart: next, now: new Date('2026-10-06T13:00:00.001Z') });
  assert.equal(afterDeadline.publicationDeadlinePassed, true);
  assert.equal(afterDeadline.activationDue, false, 'missing the publication deadline must not activate the target season');
  const activation = resolveSeasonLifecycleWindow({ seasonStart: start, nextSeasonStart: next, now: next });
  assert.equal(activation.activationDue, true);
  assert.equal(activation.leagueMatchesPaused, true);
});

test('S2 onward uses the same Day 15 and 16:00 MSK publication deadline on a 15-day cycle', () => {
  const start = new Date('2026-10-08T15:00:00.000Z');
  const next = new Date('2026-10-23T15:00:00.000Z');
  const window = resolveSeasonLifecycleWindow({ seasonStart: start, nextSeasonStart: next, now: new Date('2026-10-22T15:00:00.000Z') });
  assert.equal(window.offseasonStartAt.toISOString(), '2026-10-22T15:00:00.000Z');
  assert.equal(window.offseasonDayEndsAt.toISOString(), '2026-10-23T15:00:00.000Z');
  assert.equal(window.publicationDeadlineAt.toISOString(), '2026-10-23T13:00:00.000Z');
  assert.equal(window.activationAt.toISOString(), next.toISOString());
});

test('invalid lifecycle dates fail closed', () => {
  assert.throws(() => resolveSeasonLifecycleWindow({
    seasonStart: 'not-a-date',
    nextSeasonStart: '2026-10-23T15:00:00.000Z',
    now: new Date('2026-10-20T15:00:00.000Z'),
  }), /INVALID_SEASON_LIFECYCLE_WINDOW/);
});