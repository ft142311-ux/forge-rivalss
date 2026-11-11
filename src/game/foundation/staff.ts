import { STAFF_BONUSES } from './config';

export function staffBonuses(staff?: Record<string, any>) {
  const result = { training: 0, match: 0, scouting: 0, youth: 0, injury: 0, recovery: 0, economy: 0 };
  for (const [role, bonus] of Object.entries(STAFF_BONUSES)) {
    if (!staff?.[role]) continue;
    for (const [key, value] of Object.entries(bonus)) (result as any)[key] += Number(value || 0);
  }
  return result;
}

export const FOUNDATION_STAFF_ROLES = ['recruiter', 'coach', 'analyst', 'scout', 'doctor', 'financier'] as const;
export type FoundationStaffRole = typeof FOUNDATION_STAFF_ROLES[number];

export const STAFF_BUILDING_REQUIREMENTS: Record<Exclude<FoundationStaffRole, 'recruiter'>, string> = {
  coach: 'bootcamp',
  analyst: 'hq',
  scout: 'academy',
  doctor: 'medical',
  financier: 'hq',
};

export function buildingStaffRequirement(building: string) {
  const map: Record<string, string> = {
    training: 'coach',
    scouting: 'scout',
    medical: 'doctor',
    analytics: 'analyst',
    finances: 'financier',
  };
  return map[building] || null;
}

export function staffCapacity(hq?: Record<string, any>) {
  const level = Math.max(1, Number(hq?.hrLevel || 1));
  return level + 1;
}
