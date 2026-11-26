import type { FoundationRole, TrainingSkill } from './types';
import { ROLE_SKILL_WEIGHTS } from './config';

export const ROLE_LABELS: Record<FoundationRole,string> = {
  Carry: 'Керри', Midlaner: 'Мидер', Tank: 'Танк', Jungler: 'Лес', Support: 'Саппорт'
};

export const ROLE_PRIORITY_SKILLS: Record<FoundationRole, TrainingSkill[]> = {
  Midlaner: ['reflexes','lastHitting','ganking','positioning','tiltResistance'],
  Carry: ['lastHitting','positioning','reflexes','tiltResistance','versatility'],
  Tank: ['objectiveControl','positioning','tiltResistance','versatility','mapAwareness'],
  Jungler: ['ganking','objectiveControl','communication','mapAwareness','versatility'],
  Support: ['communication','objectiveControl','positioning','mapAwareness','tiltResistance'],
};

export function roleSuitability(player: any, role: FoundationRole) {
  const stats = player?.proStats || {};
  const weights = ROLE_SKILL_WEIGHTS[role] || {};
  let weighted = 0, total = 0;
  for (const [skill, weight] of Object.entries(weights)) {
    const w = Number(weight) || 0;
    weighted += Math.max(0, Math.min(100, Number(stats[skill] ?? 0))) * w;
    total += w;
  }
  const value = total ? weighted / total : Number(player?.overallRating || 0);
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function suitabilityLevel(value: number): 'excellent'|'good'|'average'|'poor' {
  if (value >= 80) return 'excellent';
  if (value >= 65) return 'good';
  if (value >= 50) return 'average';
  return 'poor';
}

export function roleFitDelta(player: any, role: FoundationRole) {
  return Math.round(roleSuitability(player, role) - Number(player?.overallRating || 0));
}

export function roleForSlot(slot: string): FoundationRole | null {
  return ({carry:'Carry',mid:'Midlaner',offlane:'Tank',support:'Jungler',full_support:'Support'} as Record<string,FoundationRole>)[slot] || null;
}
