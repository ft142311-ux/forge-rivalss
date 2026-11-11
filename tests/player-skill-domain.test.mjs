import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAYER_SKILL_KEYS, isPlayerSkillKey } from '../src/game/player-skills.ts';
import { FOUNDATION_SKILLS, isFoundationSkill } from '../src/game/foundation/skills.ts';

const source = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('shared player skill domain preserves the canonical ten-skill order', () => {
  assert.deepEqual(PLAYER_SKILL_KEYS, [
    'lastHitting', 'mapAwareness', 'positioning', 'reflexes',
    'manaManagement', 'objectiveControl', 'communication',
    'tiltResistance', 'versatility', 'ganking',
  ]);
});

test('Foundation exports remain backwards-compatible aliases of the shared domain', () => {
  assert.strictEqual(FOUNDATION_SKILLS, PLAYER_SKILL_KEYS);
  for (const skill of PLAYER_SKILL_KEYS) {
    assert.equal(isPlayerSkillKey(skill), true);
    assert.equal(isFoundationSkill(skill), true);
  }
  for (const value of [null, undefined, '', 'last_hitting', 'unknown', 42, {}]) {
    assert.equal(isPlayerSkillKey(value), false);
    assert.equal(isFoundationSkill(value), false);
  }
});

test('Foundation TrainingSkill type derives from the shared player skill type', () => {
  const types = source('src/game/foundation/types.ts');
  const foundation = source('src/game/foundation/skills.ts');
  assert.match(types, /import type \{ PlayerSkillKey \} from ['"]\.\.\/player-skills['"]/);
  assert.match(types, /export type TrainingSkill = PlayerSkillKey;/);
  assert.match(foundation, /export const FOUNDATION_SKILLS = PLAYER_SKILL_KEYS;/);
});

test('match simulation consumes the shared skill list instead of declaring a second list', () => {
  const simulation = source('src/app/lib/match-simulation.ts');
  assert.match(simulation, /import \{ PLAYER_SKILL_KEYS \} from ['"]@\/game\/player-skills['"]/);
  assert.match(simulation, /const SKILLS = PLAYER_SKILL_KEYS;/);
  assert.doesNotMatch(simulation, /const SKILLS = \[['"]lastHitting['"]/);
});

test('legacy MMO adapter builds its required proStats schema from the shared skill keys', () => {
  const adapter = source('src/ai/flows/simulate-moba-match.ts');
  assert.match(adapter, /PLAYER_SKILL_KEYS\.map\(\(skill\) => \[skill, z\.number\(\)\]\)/);
  assert.match(adapter, /const ProStatsSchema = z\.object\(/);
  assert.doesNotMatch(adapter, /lastHitting\s*:\s*z\.number\(\)/);
});

test('autonomous post-match training validates focus through the shared skill guard', () => {
  const cycle = source('src/app/actions/autonomous-cycle.ts');
  assert.match(cycle, /import \{ isPlayerSkillKey \} from ['"]@\/game\/player-skills['"]/);
  assert.match(cycle, /isPlayerSkillKey\(String\(focus\)\)/);
  assert.doesNotMatch(cycle, /\[['"]lastHitting['"],\s*['"]mapAwareness['"]/);
});
