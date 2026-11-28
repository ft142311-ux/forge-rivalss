import { ARENA_BASE_CAPACITY, getArenaExpansionQuote } from './arena-expansion';

export type ConstructionSection = 'arena' | 'hq' | 'bootcamp' | 'academy' | 'medical';

export const ALLOWED_CONSTRUCTION_IDS: Record<ConstructionSection, string[]> = {
  arena: ['pressCenterLevel', 'cafeLevel', 'shopLevel', 'screensLevel', 'parkingLevel', 'lightingLevel'],
  hq: ['hrLevel', 'financeLevel', 'scoutsLevel', 'pressOfficeLevel', 'adminLevel'],
  bootcamp: ['bootcampLevel', 'tacticsHallLevel', 'poolLevel', 'researchLevel'],
  academy: ['youthBootcampLevel', 'streamingLevel', 'scoutsLevel', 'discoLevel'],
  medical: ['physiotherapyLevel', 'massageLevel', 'psychiatristLevel', 'labLevel', 'psychologistLevel'],
};

function readNonNegativeInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    if (!Number.isSafeInteger(fallback) || fallback < 0) throw new Error('INVALID_CONSTRUCTION_STATE');
    return fallback;
  }
  if (typeof value === 'string' && value.trim() === '') throw new Error('INVALID_CONSTRUCTION_STATE');
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('INVALID_CONSTRUCTION_STATE');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('INVALID_CONSTRUCTION_STATE');
  return parsed;
}

function readTimestampMillis(value: unknown): number {
  try {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && 'toDate' in value &&
        typeof (value as { toDate?: unknown }).toDate === 'function') {
      const date = (value as { toDate: () => Date }).toDate();
      return date instanceof Date ? date.getTime() : Number.NaN;
    }
    return new Date(String(value ?? '')).getTime();
  } catch {
    return Number.NaN;
  }
}

export function getConstructionFinishMillis(value: unknown): number {
  const finishMs = readTimestampMillis(value);
  if (!Number.isFinite(finishMs) || finishMs <= 0) {
    throw new Error('INVALID_CONSTRUCTION_STATE');
  }
  return finishMs;
}

export function getConstructionStartBlocker(
  finishes: Record<string, unknown> | null | undefined,
  nowMs: number,
): string | null {
  if (!Number.isFinite(nowMs)) throw new Error('INVALID_CONSTRUCTION_STATE');
  const finishTimes = Object.values(finishes ?? {}).map(getConstructionFinishMillis);
  if (finishTimes.some((finishMs) => finishMs <= nowMs)) {
    return 'CONSTRUCTION_COMPLETION_PENDING';
  }
  return finishTimes.length > 0 ? 'CONSTRUCTION_ALREADY_IN_PROGRESS' : null;
}

export function getNextConstructionLevel(currentValue: unknown): number {
  const current = readNonNegativeInteger(currentValue, 0);
  const nextLevel = current + 1;
  if (!Number.isSafeInteger(nextLevel)) throw new Error('INVALID_CONSTRUCTION_STATE');
  return nextLevel;
}

export type ConstructionFinalizationInput = {
  section: ConstructionSection;
  id: string;
  finish: unknown;
  currentValue: unknown;
  targetValue: unknown;
  nowMs: number;
};

export function resolveConstructionFinalization(input: ConstructionFinalizationInput): {
  due: boolean;
  target: number;
} {
  const { section, id, finish, currentValue, targetValue, nowMs } = input;
  const isCapacity = section === 'arena' && id === 'capacity';
  const allowedIds = ALLOWED_CONSTRUCTION_IDS[section];
  const isAllowed = isCapacity || (Array.isArray(allowedIds) && allowedIds.includes(id));
  if (!isAllowed || !Number.isFinite(nowMs)) throw new Error('INVALID_CONSTRUCTION_STATE');

  const finishMs = getConstructionFinishMillis(finish);

  const current = readNonNegativeInteger(
    currentValue,
    isCapacity ? ARENA_BASE_CAPACITY : 0,
  );

  let target: number;
  if (isCapacity) {
    if (targetValue === undefined || targetValue === null) {
      throw new Error('INVALID_CONSTRUCTION_STATE');
    }
    target = readNonNegativeInteger(targetValue, -1);
    try {
      const quote = getArenaExpansionQuote(target - current, current);
      if (quote.targetCapacity !== target) throw new Error('INVALID_CONSTRUCTION_STATE');
    } catch {
      throw new Error('INVALID_CONSTRUCTION_STATE');
    }
  } else {
    target = readNonNegativeInteger(targetValue, current + 1);
    if (target !== current + 1) throw new Error('INVALID_CONSTRUCTION_STATE');
  }

  return { due: finishMs <= nowMs, target };
}
