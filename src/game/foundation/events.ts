import type { FoundationManagerState } from './types';

export interface DailyEvent { id: string; title: string; description: string; effects: Record<string, number>; }

export const DAILY_EVENTS: DailyEvent[] = [
  { id: 'positive-training', title: 'Удачная тренировка', description: 'Команда провела продуктивную тренировочную сессию.', effects: { trainingBonus: 0.10 } },
  { id: 'team-morale', title: 'Командный подъём', description: 'Настроение игроков улучшилось.', effects: { form: 3, tilt: -3 } },
  { id: 'minor-fatigue', title: 'Повышенная нагрузка', description: 'После плотного игрового дня игроки устали сильнее.', effects: { fatigue: -3 } },
];

export function eventChance(manager: FoundationManagerState) {
  const license = Number(manager.licenses?.coaching?.tier || manager.licenses?.tier || 0);
  return Math.min(.35, .15 + license * .02);
}

export function deterministicDailyEvent(manager: FoundationManagerState, dayKey: string): DailyEvent | null {
  const chance = eventChance(manager);
  let hash = 2166136261;
  const source = `${manager.id}:${dayKey}`;
  for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  const roll = (hash >>> 0) / 4294967296;
  if (roll >= chance) return null;
  return DAILY_EVENTS[(hash >>> 8) % DAILY_EVENTS.length];
}
