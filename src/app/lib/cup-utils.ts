import { MAX_LEVELS } from './leagues-data';
import { createDeterministicBotSquad } from './match-simulation';
import { runMatchEngine } from './match-engine';

export interface CupParticipant {
  id: string;
  name: string;
  isPlayer: boolean;
  level: number;
}

/**
 * Рассчитывает, в каком раунде дивизион вступает в борьбу.
 * Див 4 начинает с Раунда 0.
 * Див 1 начинает с Раунда 3.
 */
export function getEntryRound(level: number): number {
  return Math.max(0, MAX_LEVELS - level);
}

/**
 * Генерирует стабильный список из 4096 участников кубка для конкретной лиги.
 * Все слоты привязаны к Tier-Group-Slot.
 */
export function getLeagueCupParticipants(leagueId: string, realPlayersInLeague: any[], seasonNumber: number): (CupParticipant | null)[] {
  const TOTAL_SLOTS = 4096;
  const fullList: (CupParticipant | null)[] = Array(TOTAL_SLOTS).fill(null);
  
  const playerMap = new Map<string, any>();
  realPlayersInLeague.forEach(p => {
    const key = `${p.leagueLevel}_${p.groupId}_${p.rank || 1}`;
    playerMap.set(key, p);
  });

  // Safe mapping for consolidated league
  const leagueIdx = "01";

  let currentGlobalIndex = 0;
  for (let lvl = 1; lvl <= MAX_LEVELS; lvl++) {
    const groupsInDiv = Math.pow(2, lvl - 1);
    for (let g = 1; g <= groupsInDiv; g++) {
      for (let slot = 1; slot <= 8; slot++) {
        if (currentGlobalIndex >= TOTAL_SLOTS) break;
        const key = `${lvl}_${g}_${slot}`;
        const real = playerMap.get(key);
        
        if (real) {
          fullList[currentGlobalIndex] = {
            id: real.id,
            name: real.displayName || "Manager",
            isPlayer: true,
            level: lvl
          };
        } else {
          const botId = `BOT${leagueIdx}${lvl}${g.toString().padStart(3, '0')}${slot}`;
          fullList[currentGlobalIndex] = {
            id: botId,
            name: botId,
            isPlayer: false,
            level: lvl
          };
        }
        currentGlobalIndex++;
      }
    }
  }

  return fullList;
}

/**
 * Рекурсивно определяет победителя ветки в Кубке.
 */
export function getWinnerOfBranch(
  participants: (CupParticipant | null)[], 
  round: number, 
  startIndex: number, 
  cache: Map<string, CupParticipant | null>,
  limitDay: number,
  season: number
): CupParticipant | null {
  const key = `${startIndex}-${round}`;
  if (cache.has(key)) return cache.get(key)!;
  
  if (round === 0) return participants[startIndex] || null;
  if (round > limitDay) return null;
  
  const step = Math.pow(2, round - 1);
  const h = getWinnerOfBranch(participants, round - 1, startIndex, cache, limitDay, season);
  const a = getWinnerOfBranch(participants, round - 1, startIndex + step, cache, limitDay, season);
  
  if (!h && !a) { cache.set(key, null); return null; }
  if (!h) { cache.set(key, a); return a; }
  if (!a) { cache.set(key, h); return h; }

  const hEntry = getEntryRound(h.level);
  const aEntry = getEntryRound(a.level);

  if (round <= hEntry && round <= aEntry) {
    cache.set(key, h); 
    return h;
  }

  const simulation = runMatchEngine({
      mode: 'cup',
    matchId: `cup_${season}_${round}_${h.id}_${a.id}`,
    teamA: { id: h.id, name: h.name, players: createDeterministicBotSquad(`cup:${h.id}:${h.level}`, Math.max(23, 28 - h.level)), strategy: 'Balanced Play' },
    teamB: { id: a.id, name: a.name, players: createDeterministicBotSquad(`cup:${a.id}:${a.level}`, Math.max(23, 28 - a.level)), strategy: 'Balanced Play' },
    bestOf: 1,
  });
  const winner = simulation.winnerSide === 'home' ? h : a; 
  
  cache.set(key, winner);
  return winner;
}
