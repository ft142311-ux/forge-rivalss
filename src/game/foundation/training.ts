import { ROLE_SKILL_WEIGHTS, TRAINING_RULES } from './config';
import { clamp, playerTalent, playerSkill } from './player-system';
import type { FoundationPlayerState, TrainingResult, TrainingSkill } from './types';

export function trainingCap(player: FoundationPlayerState, skill: TrainingSkill) {
  const stored = Number(player.skillCaps?.[skill]);
  if (Number.isFinite(stored) && stored > 0) return clamp(stored);
  return clamp(Math.max(playerSkill(player, skill) + 1, 45 + playerTalent(player, skill) * .55));
}

export function trainingAgeFactor(age: number) {
  if (age < TRAINING_RULES.youngAge) return 1.22;
  if (age < TRAINING_RULES.primeAge) return 1.08;
  if (age < TRAINING_RULES.declineAge) return .94;
  return .78;
}

function normalizedAttribute(value: unknown, fallback = 50) {
  const n = Number(value);
  return clamp(Number.isFinite(n) ? n : fallback);
}

export function trainingRoleFactor(player: FoundationPlayerState, skill: TrainingSkill) {
  return .80 + Number(ROLE_SKILL_WEIGHTS[player.currentRole || player.role]?.[skill] || .10) * 1.8;
}

/**
 * Skill growth is accumulated from match minutes. The three player-development
 * attributes are intentionally separate from talent: propensity, physical
 * condition and resilience all influence how quickly progress is earned.
 */
export function calculateTrainingGain(player: FoundationPlayerState, skill: TrainingSkill, minutes: number) {
  const oldValue = playerSkill(player, skill);
  const cap = trainingCap(player, skill);
  const talent = playerTalent(player, skill);
  const inclination = normalizedAttribute(player.skillInclinations?.[skill], 50);
  const propensity = normalizedAttribute(player.trainingPropensity, 50);
  const physical = normalizedAttribute(player.physical, 50);
  const resilience = normalizedAttribute(player.resilience, 50);
  const nearCap = oldValue >= cap * TRAINING_RULES.capSlowdownAt;
  const capFactor = nearCap ? TRAINING_RULES.capSlowdownFactor : oldValue >= cap * .80 ? .55 : 1;
  const minutesFactor = Math.max(0, Math.min(1.25, Number(minutes || 0) / 90));
  const propensityFactor = .65 + (propensity / 100) * TRAINING_RULES.propensityWeight;
  const physicalFactor = .825 + (physical / 100) * TRAINING_RULES.physicalWeight;
  const resilienceFactor = .875 + (resilience / 100) * TRAINING_RULES.resilienceWeight;
  const gain = TRAINING_RULES.basePer90
    * trainingAgeFactor(Number(player.age || 20))
    * (.70 + talent / 100)
    * (.75 + inclination / 400)
    * propensityFactor
    * physicalFactor
    * resilienceFactor
    * trainingRoleFactor(player, skill)
    * capFactor
    * minutesFactor;
  return { gain, cap, oldValue, nearCap };
}

export function applyTraining(player: FoundationPlayerState, skill: TrainingSkill, minutes: number): { player: FoundationPlayerState; result: TrainingResult } {
  const { gain, cap, oldValue, nearCap } = calculateTrainingGain(player, skill, minutes);
  const previousProgress = Number(player.trainingProgress?.[skill] || 0);
  const total = previousProgress + gain;
  const whole = Math.floor(total);
  const newValue = Math.min(cap, oldValue + whole);
  const progress = newValue >= cap ? 0 : Math.max(0, total - whole);
  const next: FoundationPlayerState = {
    ...player,
    proStats: { ...player.proStats, [skill]: newValue },
    skillCaps: { ...(player.skillCaps || {}), [skill]: cap },
    trainingProgress: { ...(player.trainingProgress || {}), [skill]: progress },
  };
  return { player: next, result: { playerId: player.id, skill, oldValue, newValue, progress, cap, gain, minutes, slowedByCap: nearCap } };
}
