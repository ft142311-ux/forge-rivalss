/**
 * @fileOverview Ядро времени v126 (Moscow Hours Helper). 
 */

let syncPoint = {
  serverMs: typeof Date !== 'undefined' ? Date.now() : 0,
  perfMs: typeof performance !== 'undefined' ? performance.now() : 0
};

const SIMULATION_OFFSET_MS = 0; 
const MSK_OFFSET = 3 * 60 * 60 * 1000;

export const GLOBAL_EPOCH_ISO = '2026-09-21T15:00:00Z'; // Season 1 starts at 18:00 MSK.
export const FIRST_SEASON_NEXT_START_ISO = '2026-10-08T15:00:00.000Z'; // Confirmed planned start of Season 2.
export const SEASON_CYCLE_DAYS = 15; // Normal cadence after the one-time S1 -> S2 boundary.

export function setServerTime(serverMs: number) {
  if (typeof performance !== 'undefined') {
    syncPoint = { serverMs, perfMs: performance.now() };
  } else {
    syncPoint = { serverMs, perfMs: 0 };
  }
}

export function getMoscowTime(): Date {
  const isBrowser = typeof window !== 'undefined';
  let currentUtcMs;
  if (isBrowser && performance && syncPoint.perfMs > 0) {
    const elapsed = performance.now() - syncPoint.perfMs;
    currentUtcMs = syncPoint.serverMs + elapsed;
  } else {
    currentUtcMs = Date.now(); 
  }
  return new Date(currentUtcMs + SIMULATION_OFFSET_MS);
}

export function getMoscowHours(): number {
  const now = getMoscowTime();
  // Используем UTC + 3 часа для МСК
  return (now.getUTCHours() + 3) % 24;
}

export function toMskDate(date: Date): Date {
  return new Date(date.getTime() + MSK_OFFSET);
}

export function getLevelThreshold(level: number): number {
  if (level === 1) return 700;
  if (level === 2) return 1400;
  if (level === 3) return 3800;
  return 3800 * Math.pow(2, level - 3);
}

export function getMoscowDateString(): string {
  const msk = toMskDate(getMoscowTime());
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`;
}

export function getGlobalSeasonInfo(now: Date = getMoscowTime()) {
  const simNow = now;
  const epochUtc = new Date(GLOBAL_EPOCH_ISO);
  const firstNextStart = new Date(FIRST_SEASON_NEXT_START_ISO);
  const dayMs = 24 * 60 * 60 * 1000;
  const cycleMs = SEASON_CYCLE_DAYS * dayMs;

  // Season 1 has an explicitly scheduled first boundary (2026-10-08).
  // From Season 2 onward the normal 15-day cadence is used. Keeping this
  // boundary explicit avoids the old 15-day calculation starting S2 on Oct 6.
  let seasonNumber: number;
  let currentSeasonStart: Date;
  let nextSeasonStart: Date;
  let dayOfCycle: number;

  if (simNow.getTime() < firstNextStart.getTime()) {
    seasonNumber = 1;
    currentSeasonStart = epochUtc;
    nextSeasonStart = firstNextStart;
    dayOfCycle = Math.floor((simNow.getTime() - epochUtc.getTime()) / dayMs) + 1;
  } else {
    const elapsedAfterS2 = Math.max(0, simNow.getTime() - firstNextStart.getTime());
    const completedCycles = Math.floor(elapsedAfterS2 / cycleMs);
    seasonNumber = 2 + completedCycles;
    currentSeasonStart = new Date(firstNextStart.getTime() + completedCycles * cycleMs);
    nextSeasonStart = new Date(currentSeasonStart.getTime() + cycleMs);
    dayOfCycle = Math.floor((simNow.getTime() - currentSeasonStart.getTime()) / dayMs) + 1;
  }

  const isOffseason = dayOfCycle === 15;
  const isTransitionDay = isOffseason;
  const preparationAt = new Date(currentSeasonStart.getTime() + 14 * dayMs - 2 * 60 * 60 * 1000);
  const isPreparationDay = simNow.getTime() >= preparationAt.getTime() && simNow.getTime() < nextSeasonStart.getTime();

  if (simNow.getTime() < epochUtc.getTime()) {
    return {
      seasonDay: 1, dayOfCycle: 1, seasonNumber: 1, activeSeasonNumber: 1,
      isOffseason: false, isTransitionDay: false, isPreparationDay: false,
      timeToStartMs: epochUtc.getTime() - simNow.getTime(), currentSeasonStart: epochUtc,
      nextSeasonStart: firstNextStart,
    };
  }

  return {
    seasonDay: dayOfCycle > 14 ? 0 : dayOfCycle,
    dayOfCycle, seasonNumber, activeSeasonNumber: seasonNumber,
    isOffseason, isTransitionDay, isPreparationDay,
    preparationAt, currentSeasonStart, nextSeasonStart,
  };
}

/**
 * Рассчитывает текущий возраст игрока на основе базового возраста при найме.
 */
export const PLAYER_GAME_YEAR_DAYS = 7;
export const PLAYER_GAME_MONTHS = 12;
export const PLAYER_GAME_YEAR_MS = PLAYER_GAME_YEAR_DAYS * 24 * 60 * 60 * 1000;
export const PLAYER_GAME_MONTH_MS = PLAYER_GAME_YEAR_MS / PLAYER_GAME_MONTHS;

/**
 * Player age uses the game calendar, not the real-world calendar:
 * 1 real week = 1 game year.
 * Display format is 18.0 ... 18.12, then 19.0.
 */
export function calculateLiveAge(baseAge: number, hiredAtIso: string, birthDateIso?: string | null) {
  const now = getMoscowTime();
  const yearMs = PLAYER_GAME_YEAR_MS;
  const monthMs = PLAYER_GAME_MONTH_MS;
  const birthMs = birthDateIso ? new Date(birthDateIso).getTime() : NaN;
  if (Number.isFinite(birthMs)) {
    const elapsed = Math.max(0, now.getTime() - birthMs);
    const years = Math.floor(elapsed / yearMs);
    const remainder = elapsed - years * yearMs;
    const month = Math.min(12, Math.floor(remainder / monthMs + 1e-9));
    return { numeric: years + month / 12, display: `${years}.${month}` };
  }
  const safeBaseAge = Number(baseAge) > 0 ? Number(baseAge) : 18;
  const hiredAt = new Date(hiredAtIso);
  const elapsed = safeBaseAge * yearMs + Math.max(0, now.getTime() - hiredAt.getTime());
  const years = Math.floor(elapsed / yearMs);
  const remainder = elapsed - years * yearMs;
  const month = Math.min(12, Math.floor(remainder / monthMs + 1e-9));
  return { numeric: years + month / 12, display: `${years}.${month}` };
}

export function isMatchStarted(startTimeIso: string): boolean {
  const simNow = getMoscowTime();
  const start = new Date(startTimeIso);
  return simNow.getTime() >= start.getTime();
}

export function isMatchOverdue(startTimeIso: string): boolean {
  const simNow = getMoscowTime();
  const start = new Date(startTimeIso);
  return simNow.getTime() > (start.getTime() + (45 * 60 * 1000));
}

export function isMatchLive(startTimeIso: string): boolean {
  const simNow = getMoscowTime();
  const start = new Date(startTimeIso);
  const end = new Date(start.getTime() + (45 * 60 * 1000));
  return simNow.getTime() >= start.getTime() && simNow.getTime() <= end.getTime();
}
