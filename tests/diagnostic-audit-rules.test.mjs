import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EXPECTED_PRO_STATS, validateBotPlayer } = require('../scripts/bot-audit-rules.cjs');
const { buildSuccessfulRebuildConfig } = require('../scripts/rebuild-config-helper.cjs');

const validStats = Object.fromEntries(EXPECTED_PRO_STATS.map((key, index) => [key, 20 + index]));

test('bot audit checks OVR separately and accepts numeric proStats outside OVR range', () => {
  const errors = validateBotPlayer({ overallRating: 23, proStats: validStats });
  assert.deepEqual(errors, []);
});

test('bot audit rejects missing, incomplete, or non-numeric proStats', () => {
  const missing = { overallRating: 27, proStats: { ...validStats } };
  delete missing.proStats.ganking;
  assert.ok(validateBotPlayer(missing).includes('PROSTATS_MISSING_FIELD:ganking'));

  const nonNumeric = { overallRating: 27, proStats: { ...validStats, reflexes: '24' } };
  assert.ok(validateBotPlayer(nonNumeric).includes('PROSTATS_NON_NUMERIC:reflexes'));

  assert.ok(validateBotPlayer({ overallRating: 27 }).includes('PROSTATS_MISSING_OR_NOT_OBJECT'));
});

test('bot audit keeps OVR range enforcement', () => {
  const errors = validateBotPlayer({ overallRating: 28, proStats: validStats });
  assert.ok(errors.includes('OVR_OUT_OF_RANGE:28'));
});

test('successful rebuild patch deletes stale rebuildError', () => {
  const deleted = Symbol('FieldValue.delete');
  const fakeAdmin = {
    firestore: {
      FieldValue: {
        delete: () => deleted,
        serverTimestamp: () => 'SERVER_TIMESTAMP',
      },
    },
  };
  const patch = buildSuccessfulRebuildConfig(fakeAdmin, new Date('2026-09-21T15:00:00.000Z'));
  assert.equal(patch.rebuildError, deleted);
  assert.equal(patch.rebuildStatus, 'STAGE_3A8_COMPLETE');
  assert.equal(patch.worldReady, true);
});
