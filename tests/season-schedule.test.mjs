import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalSeasonInfo, FIRST_SEASON_NEXT_START_ISO } from '../src/app/lib/time-utils.ts';

test('the confirmed S1 to S2 boundary is October 8 at 15:00 UTC', () => {
  assert.equal(FIRST_SEASON_NEXT_START_ISO, '2026-10-08T15:00:00.000Z');
  const before = getGlobalSeasonInfo(new Date('2026-10-08T14:59:59.999Z'));
  const at = getGlobalSeasonInfo(new Date('2026-10-08T15:00:00.000Z'));
  assert.equal(before.seasonNumber, 1);
  assert.equal(before.nextSeasonStart.toISOString(), '2026-10-08T15:00:00.000Z');
  assert.equal(at.seasonNumber, 2);
  assert.equal(at.currentSeasonStart.toISOString(), '2026-10-08T15:00:00.000Z');
});

test('after the one-time S1 to S2 boundary, the normal 15-day cadence continues', () => {
  const duringS2 = getGlobalSeasonInfo(new Date('2026-10-17T15:00:00.000Z'));
  const atS3 = getGlobalSeasonInfo(new Date('2026-10-23T15:00:00.000Z'));
  assert.equal(duringS2.seasonNumber, 2);
  assert.equal(duringS2.nextSeasonStart.toISOString(), '2026-10-23T15:00:00.000Z');
  assert.equal(atS3.seasonNumber, 3);
  assert.equal(atS3.currentSeasonStart.toISOString(), '2026-10-23T15:00:00.000Z');
});
