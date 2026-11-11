import test from 'node:test';
import assert from 'node:assert/strict';
import { STAT_KEYS } from '../src/app/lib/player-stats.ts';
import { FOUNDATION_SKILLS, isFoundationSkill } from '../src/game/foundation/skills.ts';

test('shared player skill keys preserve the canonical ten-skill order', () => {
  assert.deepEqual(STAT_KEYS, [
    'lastHitting', 'mapAwareness', 'positioning', 'reflexes',
    'manaManagement', 'objectiveControl', 'communication',
    'tiltResistance', 'versatility', 'ganking',
  ]);
});


test('UI skill keys are the same canonical Foundation skill list', () => {
  assert.strictEqual(STAT_KEYS, FOUNDATION_SKILLS);
});

test('Foundation training validator accepts only the canonical skill keys', () => {
  for (const skill of FOUNDATION_SKILLS) assert.equal(isFoundationSkill(skill), true);
  for (const value of [null, undefined, '', 'last_hitting', 'unknown', 42]) {
    assert.equal(isFoundationSkill(value), false);
  }
});
