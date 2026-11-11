export interface AwardCandidate { playerId: string; playerName: string; score: number; reason: string; }

export function scoreGoldenPlayer(stats: Record<string, any>) {
  return Number(stats.matches || 0) * 2 + Number(stats.wins || 0) * 5 + Number(stats.successfulActions || 0) + Number(stats.postMatchRating || 0) * 3;
}

export function chooseGoldenPlayer(candidates: AwardCandidate[]) {
  return [...candidates].sort((a,b)=>b.score-a.score || a.playerId.localeCompare(b.playerId))[0] || null;
}
