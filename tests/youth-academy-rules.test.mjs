import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScoutedPlayer } from '../src/app/lib/moba-data.ts';
import {
  canAcceptYouthAuctionPurchase,
  getYouthAcademyCapacity,
  getYouthScoutLevel,
  isYouthMarketLockOwnedByLot,
  isYouthMarketLockValidForLot,
  readYouthAcademyRoster,
  resolveYouthPlayerAge,
} from '../src/app/lib/youth-academy-rules.ts';

test('academy capacity and scout levels reject malformed, negative and non-finite values', () => {
  assert.equal(getYouthAcademyCapacity(undefined), 10);
  assert.equal(getYouthAcademyCapacity({ youthBootcampLevel: 3 }), 13);
  assert.equal(getYouthScoutLevel({ scoutsLevel: '4' }), 4);
  assert.equal(getYouthScoutLevel({ scoutsLevel: 99 }), 20);
  assert.equal(getYouthScoutLevel({}), 0);
  assert.throws(() => getYouthAcademyCapacity({ youthBootcampLevel: -1 }), /YOUTH_ACADEMY_STATE_INVALID/);
  assert.throws(() => getYouthAcademyCapacity({ youthBootcampLevel: Number.POSITIVE_INFINITY }), /YOUTH_ACADEMY_STATE_INVALID/);
  assert.throws(() => getYouthAcademyCapacity({ youthBootcampLevel: 1001 }), /YOUTH_ACADEMY_STATE_INVALID/);
  assert.throws(() => getYouthScoutLevel({ scoutsLevel: ' ' }), /YOUTH_ACADEMY_STATE_INVALID/);
});

test('youth rosters reject malformed and duplicate player identities', () => {
  assert.deepEqual(readYouthAcademyRoster(undefined), []);
  assert.deepEqual(readYouthAcademyRoster([{ id: 'youth-1' }]), [{ id: 'youth-1' }]);
  assert.throws(() => readYouthAcademyRoster('not-an-array'), /YOUTH_ROSTER_INVALID/);
  assert.throws(() => readYouthAcademyRoster([{ id: 'same' }, { id: 'same' }]), /YOUTH_ROSTER_INVALID/);
  assert.throws(() => readYouthAcademyRoster([{ id: ' padded ' }]), /YOUTH_ROSTER_INVALID/);
});

test('game-calendar age is calculated from the birth date at the supplied server time', () => {
  const nowMs = 1_800_000_000_000;
  const gameYearMs = 7 * 24 * 60 * 60 * 1000;
  const player = {
    id: 'youth-1',
    baseAge: 14,
    hiredAt: new Date(nowMs - 17 * gameYearMs).toISOString(),
    birthDate: new Date(nowMs - 17 * gameYearMs).toISOString(),
  };
  assert.equal(resolveYouthPlayerAge(player, nowMs), 17);
  assert.equal(resolveYouthPlayerAge({ ...player, birthDate: new Date(nowMs - 18 * gameYearMs).toISOString() }, nowMs), 18);
  assert.throws(() => resolveYouthPlayerAge(player, Number.NaN), /YOUTH_PLAYER_AGE_INVALID/);
  assert.throws(() => resolveYouthPlayerAge({ ...player, birthDate: 'not-a-date' }, nowMs), /YOUTH_PLAYER_AGE_INVALID/);
  assert.throws(() => resolveYouthPlayerAge({ id: 'bad', baseAge: 14, hiredAt: 'not-a-date' }, nowMs), /YOUTH_PLAYER_AGE_INVALID/);
});

test('youth auction locks must name the exact lot and cover its complete expiry', () => {
  const player = { id: 'youth-1', transferMarketId: 'lot-a' };
  assert.equal(isYouthMarketLockOwnedByLot(player, 'lot-a'), true);
  assert.equal(isYouthMarketLockOwnedByLot(player, 'lot-b'), false);
  assert.equal(isYouthMarketLockOwnedByLot({ id: 'youth-1' }, 'lot-a'), false);
  assert.equal(isYouthMarketLockValidForLot(player, 'lot-a', 1_800_000_000_000, 1_900_000_000_000), true);
  assert.equal(isYouthMarketLockValidForLot(player, 'lot-a', 1_800_000_000_000, null), false);
  assert.equal(isYouthMarketLockValidForLot(player, 'lot-b', 1_800_000_000_000, 1_900_000_000_000), false);
  assert.equal(isYouthMarketLockValidForLot(player, 'lot-a', 1_900_000_000_000, 1_800_000_000_000), false);
});

test('youth auction purchases are rejected when the academy is full or the player is already owned', () => {
  const fullRoster = Array.from({ length: 10 }, (_, index) => ({ id: 'youth-' + index }));
  assert.equal(canAcceptYouthAuctionPurchase([], {}, 'new-youth'), true);
  assert.equal(canAcceptYouthAuctionPurchase(fullRoster, {}, 'new-youth'), false);
  assert.equal(canAcceptYouthAuctionPurchase(fullRoster, { youthBootcampLevel: 1 }, 'new-youth'), true);
  assert.equal(canAcceptYouthAuctionPurchase([{ id: 'same-youth' }], {}, 'same-youth'), false);
});

test('scouted candidates use deterministic server-supplied identity and game-calendar timestamps', () => {
  const nowMs = 1_800_000_000_000;
  const base = generateScoutedPlayer(0, 0, 'candidate-seed', nowMs);
  const repeated = generateScoutedPlayer(0, 0, 'candidate-seed', nowMs);
  assert.deepEqual(base, repeated);
  assert.equal(base.isYouth, true);
  assert.equal(base.hiredAt, new Date(nowMs).toISOString());
  assert.ok(base.baseAge >= 14 && base.baseAge <= 17);
  assert.equal(base.birthDate, repeated.birthDate);
});
