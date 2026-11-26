import { FOUNDATION_SKILLS, ROLE_SKILL_WEIGHTS } from './config';
import type { FoundationPlayerState, FoundationRole, TrainingSkill } from './types';

export function clamp(value: number, min = 0, max = 100) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
export function playerSkill(player: FoundationPlayerState, skill: TrainingSkill) { return clamp(Number(player.proStats?.[skill] ?? 0)); }
export function playerTalent(player: FoundationPlayerState, skill: TrainingSkill) { return clamp(Number(player.proTalents?.[skill] ?? 0)); }

export function roleFit(player: FoundationPlayerState, role: FoundationRole) {
  const weights = ROLE_SKILL_WEIGHTS[role];
  let weighted = 0, total = 0;
  for (const skill of FOUNDATION_SKILLS) {
    const weight = Number(weights[skill] || 0);
    if (!weight) continue;
    weighted += playerSkill(player, skill) * weight;
    total += weight;
  }
  return total ? clamp(weighted / total) : clamp(Number(player.overallRating || 0));
}

export function calculateRoleRating(player: FoundationPlayerState, role: FoundationRole) {
  const base = roleFit(player, role);
  const form = .85 + clamp(player.form) / 666.6667;
  const fatigue = .75 + clamp(player.fatigue) / 400;
  const injury = player.isInjured ? .65 : 1;
  const tilt = 1 - clamp(player.tilt || 0) / 500;
  return Math.round(clamp(base * form * fatigue * injury * tilt));
}

export function calculateMarketValue(player: FoundationPlayerState) {
  const ovr = calculateRoleRating(player, player.currentRole || player.role);
  return Math.max(0, Math.round(ovr * 2000 + 40000));
}

export function calculateSalary(player: FoundationPlayerState) {
  const ovr = calculateRoleRating(player, player.currentRole || player.role);
  return Math.max(500, Math.round(500 + ovr * 125));
}
