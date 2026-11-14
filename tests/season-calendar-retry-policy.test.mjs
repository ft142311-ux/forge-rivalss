import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePreparedSlotRetry,
  shouldRepairExistingMatchCoordinates,
} from '../src/app/actions/season-calendar-retry-policy.ts';

test('a retry preserves a human slot when it already matches the immutable placement plan', () => {
  assert.deepEqual(
    resolvePreparedSlotRetry({ status: 'OCCUPIED', occupantId: 'CLUB_HUMAN_A' }, 'CLUB_HUMAN_A'),
    { ready: true, action: 'PRESERVE' },
  );
});

test('a retry never evicts a different human club from an occupied prepared slot', () => {
  assert.deepEqual(
    resolvePreparedSlotRetry({ status: 'OCCUPIED', occupantId: 'CLUB_HUMAN_A' }, 'CLUB_HUMAN_B'),
    { ready: false, reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' },
  );
});

test('a retry does not silently replace a human occupant with a bot placement', () => {
  assert.deepEqual(
    resolvePreparedSlotRetry({ status: 'OCCUPIED', occupantId: 'CLUB_HUMAN_A' }, 'BOT_ALPHA_L1_G1_R1'),
    { ready: false, reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' },
  );
});

test('a free slot can receive the planned human club exactly once', () => {
  assert.deepEqual(
    resolvePreparedSlotRetry({ status: 'FREE', occupantId: null }, 'CLUB_HUMAN_A'),
    { ready: true, action: 'PLACE_HUMAN' },
  );
});

test('a free slot stays unchanged when the placement plan still assigns a bot', () => {
  assert.deepEqual(
    resolvePreparedSlotRetry({ status: 'FREE', occupantId: null }, 'BOT_ALPHA_L1_G1_R1'),
    { ready: true, action: 'PRESERVE' },
  );
});

test('missing target slots are created and malformed existing slots fail closed', () => {
  assert.deepEqual(resolvePreparedSlotRetry(null, 'BOT_ALPHA_L1_G1_R1'), { ready: true, action: 'CREATE' });
  assert.deepEqual(resolvePreparedSlotRetry({ status: 'UNKNOWN' }, 'BOT_ALPHA_L1_G1_R1'),
    { ready: false, reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' });
});

test('finished match documents are immutable even when their coordinates are inconsistent', () => {
  assert.equal(shouldRepairExistingMatchCoordinates({ isFinished: true, level: 1, groupId: 1 }, 2, 3), false);
});

test('unfinished match coordinates can be repaired during an unpublished build', () => {
  assert.equal(shouldRepairExistingMatchCoordinates({ isFinished: false, level: 1, groupId: 1 }, 2, 3), true);
  assert.equal(shouldRepairExistingMatchCoordinates({ isFinished: false, level: 2, groupId: 3 }, 2, 3), false);
});
