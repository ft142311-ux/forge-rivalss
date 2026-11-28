import { STAFF_BONUSES } from './config';
import { readFoundationNonNegativeInteger, readFoundationStaff } from './guards';

export function staffBonuses(staff?: Record<string, any>) {
  // Bonuses must only be granted to persisted, hired staff with a canonical
  // role and valid payroll record. A truthy but malformed slot is not staff.
  const validatedStaff = readFoundationStaff(staff);
  const result = { training: 0, match: 0, scouting: 0, youth: 0, injury: 0, recovery: 0, economy: 0 };
  for (const [role, bonus] of Object.entries(STAFF_BONUSES)) {
    if (!validatedStaff[role]) continue;
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
  const storedLevel = readFoundationNonNegativeInteger(
    hq?.hrLevel,
    'FOUNDATION_HR_LEVEL_INVALID',
  );
  const level = Math.max(1, storedLevel);
  return level + 1;
}
