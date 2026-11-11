/**
 * @fileOverview Ядро данных лиг v160.
 * Централизованные константы и правила распределения.
 */

export const MAX_LEVELS = 4;
export const TEAMS_PER_GROUP = 8;
export const TOTAL_GROUPS = 15; // 1 + 2 + 4 + 8
export const SEASON_DURATION_DAYS = 14;
export const OFFSEASON_DURATION_DAYS = 1; // One interseason day: cycle day 15; next season starts on day 16.
export const TOTAL_CYCLE_DAYS = SEASON_DURATION_DAYS + OFFSEASON_DURATION_DAYS;

export const PROMOTION_SLOTS = 2; 
export const RELEGATION_SLOTS = 2; 

export const LEAGUES = [
  { id: 'ALPHA', startTime: '18:00', description: 'Main League' }
];

export function getGroupsCountInLevel(level: number): number {
  return Math.pow(2, level - 1);
}

export function getTableId(season: number, leagueId: string, level: number, group: number): string {
  return `table_v140_S${season}_L${leagueId}_V${level}_G${group}`;
}

export function getBotId(leagueId: string, level: number, group: number, rank: number): string {
  return `BOT_${leagueId}_L${level}_G${group}_R${rank}`;
}

export function getBotName(level: number, group: number, rank: number): string {
  const gStr = String(group).padStart(3, '0');
  const rStr = String(rank).padStart(2, '0');
  return `Bot01${level}${gStr}${rStr}`;
}


/**
 * Deterministic match result generator. Supports both league and cup callers.
 * The result is derived from the participants and match context, so repeated
 * server ticks produce the same score for the same match.
 */
export function getMatchResult(
  home: number | string,
  away: number | string,
  contextA: number,
  contextB: number,
  season?: number,
  tour?: number,
  resultSeed: number = 0
): [number, number] {
  const homeRank = typeof home === 'number' && Number.isFinite(home) ? home : 4;
  const awayRank = typeof away === 'number' && Number.isFinite(away) ? away : 4;
  const key = `${String(home)}|${String(away)}|${contextA}|${contextB}|${season ?? 0}|${tour ?? 0}|${resultSeed}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const next = () => {
    hash += 0x6D2B79F5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Lower rank number = stronger team. Keep the advantage modest.
  const homeStrength = Math.max(0, Math.min(1, (9 - homeRank) / 8));
  const awayStrength = Math.max(0, Math.min(1, (9 - awayRank) / 8));
  const homeGoals = Math.min(6, Math.floor(next() * 3.2 + homeStrength * 1.4));
  const awayGoals = Math.min(6, Math.floor(next() * 3.2 + awayStrength * 1.4));

  return [homeGoals, awayGoals];
}

export function getMatchStartUtc(seasonStart: Date, day: number): string {
  const date = new Date(seasonStart.getTime());
  date.setUTCDate(date.getUTCDate() + (day - 1));
  date.setUTCHours(15, 0, 0, 0); // 18:00 MSK = 15:00 UTC
  return date.toISOString();
}

/**
 * Генерирует детерминированный календарь матчей (Round Robin).
 */
export function generateSeasonCalendar(teams: any[], seasonNumber: number, leagueId: string, seasonStart: Date) {
  const n = TEAMS_PER_GROUP;
  const matches = [];
  const pool = Array.from({ length: n }, (_, i) => i);
  
  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const hIdx = pool[i];
      const aIdx = pool[n - 1 - i];
      const home = teams[hIdx];
      const away = teams[aIdx];

      // Первый круг (туры 1-7)
      const day1 = round + 1;
      matches.push({
        tour: day1,
        day: day1,
        season: seasonNumber,
        leagueId,
        homeId: home.id,
        homeName: home.name,
        homeRank: Number(home.rank),
        awayId: away.id,
        awayName: away.name,
        awayRank: Number(away.rank),
        startTime: getMatchStartUtc(seasonStart, day1),
        type: 'league',
        version: 140,
        isFinished: false,
        isProcessing: false,
        scoreA: 0,
        scoreB: 0
      });

      // Второй круг (туры 8-14)
      const day2 = round + 8;
      matches.push({
        tour: day2,
        day: day2,
        season: seasonNumber,
        leagueId,
        homeId: away.id,
        homeName: away.name,
        homeRank: Number(away.rank),
        awayId: home.id,
        awayName: home.name,
        awayRank: Number(home.rank),
        startTime: getMatchStartUtc(seasonStart, day2),
        type: 'league',
        version: 140,
        isFinished: false,
        isProcessing: false,
        scoreA: 0,
        scoreB: 0
      });
    }
    const last = pool.pop()!;
    pool.splice(1, 0, last);
  }
  return matches;
}
