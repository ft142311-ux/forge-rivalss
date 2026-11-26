/**
 * @fileOverview Математическое ядро системы прогрессии игроков v7.2.
 * Реализует формулы XP, талантов, влияния инфраструктуры и бесконечного OVR.
 */

import { Role } from './moba-data';

export type ActivityType = 'daily' | 'league' | 'cup' | 'friendly' | 'scrim' | 'tournament_ext' | 'trial' | 'match_reward';

export const ROLE_CORE_SKILLS: Record<Role, string[]> = {
  'Carry': ['lastHitting', 'positioning', 'reflexes', 'tiltResistance', 'versatility'],
  'Midlaner': ['reflexes', 'lastHitting', 'ganking', 'positioning', 'tiltResistance'],
  'Tank': ['objectiveControl', 'positioning', 'ganking', 'tiltResistance', 'versatility'],
  'Jungler': ['ganking', 'objectiveControl', 'reflexes', 'communication', 'versatility'],
  'Support': ['communication', 'reflexes', 'positioning', 'objectiveControl', 'tiltResistance']
};

/**
 * Рассчитывает коэффициент таланта (Мягкий кап).
 */
export function calculateTalentMultiplier(currentValue: number, talentValue: number): number {
  if (currentValue >= 100) return 0;
  if (currentValue >= talentValue) return 0.01;
  
  const threshold = talentValue * 0.9;
  if (currentValue < threshold) return 1.0;
  
  return (talentValue - currentValue) / (talentValue - threshold);
}

/**
 * Рассчитывает итоговый опыт за действие.
 */
export function calculateXpGain(params: {
  activity: ActivityType;
  currentValue: number;
  talentValue: number;
  infra: { bootcamp: number; research: number; psychologist: number };
  matchResult?: { win: boolean; mvp: boolean; matchRating?: number };
  matchesToday: number;
  isPro?: boolean;
}): number {
  if (params.currentValue >= 100) return 0;

  // 1. Базовые значения
  let baseXP = 0;
  switch (params.activity) {
    case 'daily': baseXP = 100; break;
    case 'league': baseXP = 150; break;
    case 'cup': baseXP = 180; break;
    case 'friendly': 
    case 'trial': baseXP = 50; break;
    case 'match_reward': baseXP = 40; break;
  }

  // 2. PRO Bonus (1.5x)
  if (params.isPro) baseXP *= 1.5;

  // 3. Модификаторы матча
  if (params.matchResult && params.activity !== 'daily') {
    if (params.matchResult.win) baseXP += 30;
    if (params.matchResult.mvp) baseXP += 50;
    if (params.matchResult.matchRating) {
      baseXP += (params.matchResult.matchRating - 6) * 20;
    }
    baseXP = Math.max(10, baseXP);
  }

  // 4. Влияние инфраструктуры
  const bootcampMod = 1 + (params.infra.bootcamp * 0.04);
  
  // 5. Коэффициент таланта
  const talentMod = calculateTalentMultiplier(params.currentValue, params.talentValue);

  // 6. Финальная сборка
  return Math.round(baseXP * bootcampMod * talentMod);
}

/**
 * Рассчитывает Бесконечный Динамический OVR героя v3.4.
 */
export function calculateHeroOVR(
  role: Role, 
  stats: Record<string, number>,
  totalMatches: number = 0,
  moral: number = 50,
  titles: { league: number; cup: number; friendly: number } = { league: 0, cup: 0, friendly: 0 },
  isPro: boolean = false,
  talents?: Record<string, number>
): number {
  const coreKeys = ROLE_CORE_SKILLS[role] || ROLE_CORE_SKILLS['Midlaner'];
  const allKeys = Object.keys(stats);
  const secondaryKeys = allKeys.filter(k => !coreKeys.includes(k));
  
  const coreSum = coreKeys.reduce((acc, k) => acc + (stats[k] || 0), 0);
  const secondarySum = secondaryKeys.reduce((acc, k) => acc + (stats[k] || 0), 0);
  
  const avgCore = coreSum / 5;
  const avgSecondary = secondarySum / 5;
  
  const baseOvr = (avgCore * 0.7) + (avgSecondary * 0.3);
  const matchMultiplier = 1 + (Math.sqrt(totalMatches) / (isPro ? 15 : 20));
  const moodMultiplier = 0.9 + (moral / 500);
  const legacyBonus = (titles.league * 5) + (titles.cup * 8) + (titles.friendly * 1);
  
  let proBonus = 0;
  if (isPro) {
    const maxTalent = talents ? Math.max(...Object.values(talents)) : 50;
    if (maxTalent >= 70) proBonus = 65;
    else if (maxTalent >= 60) proBonus = 55;
    else if (maxTalent > 50) proBonus = 45;
    else proBonus = 15;
  }
  
  return Math.round(baseOvr * matchMultiplier * moodMultiplier) + legacyBonus + proBonus;
}
