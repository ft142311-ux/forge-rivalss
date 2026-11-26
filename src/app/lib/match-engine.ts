import {
  simulateMatchCore,
  type MatchSimulationResult,
  type MatchTeamSnapshot,
} from './match-simulation';

/**
 * Forge-Rivals Match Engine — the single public simulation entry point.
 *
 * Match-mode adapters may prepare their own snapshots and persist results in
 * their own Firestore collections, but they must never implement or call a
 * second sporting simulator. The mode is metadata only: it does not select a
 * different algorithm or change the simulation rules.
 */
export type MatchEngineMode =
  | 'league'
  | 'cup'
  | 'tournament'
  | 'friendly'
  | 'trial'
  | 'association'
  | 'cw-basket'
  | 'training';

export interface MatchEngineRequest {
  matchId: string;
  teamA?: MatchTeamSnapshot;
  teamB?: MatchTeamSnapshot;
  home?: MatchTeamSnapshot;
  away?: MatchTeamSnapshot;
  bestOf?: 1 | 2 | 3;
  existingScore?: { a: number; b: number };
  mode?: MatchEngineMode | string;
}

/**
 * The only supported entry point for authoritative match simulation.
 * Keep this function deterministic: retries with the same matchId and input
 * must produce the same sporting result.
 */
export function runMatchEngine(request: MatchEngineRequest): MatchSimulationResult {
  const matchId = String(request.matchId || '').trim();
  if (!matchId) throw new Error('MATCH_ENGINE_ID_REQUIRED');
  if (!request.teamA && !request.home) throw new Error('MATCH_ENGINE_HOME_TEAM_REQUIRED');
  if (!request.teamB && !request.away) throw new Error('MATCH_ENGINE_AWAY_TEAM_REQUIRED');

  return simulateMatchCore({
    matchId,
    teamA: request.teamA,
    teamB: request.teamB,
    home: request.home,
    away: request.away,
    bestOf: request.bestOf,
    existingScore: request.existingScore,
    // The mode is intentionally passed only as descriptive metadata. All
    // modes share the exact same sporting calculation.
    type: normalizeMatchEngineMode(request.mode),
  });
}

/** Normalizes legacy match-type labels without changing simulation rules. */
export function normalizeMatchEngineMode(value: unknown): MatchEngineMode {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (mode.includes('cup')) return 'cup';
  if (mode.includes('tournament')) return 'tournament';
  if (mode.includes('trial')) return 'trial';
  if (mode.includes('training')) return 'training';
  if (mode.includes('association')) return 'association';
  if (mode.includes('basket') || mode.startsWith('cw-')) return 'cw-basket';
  if (mode.includes('friendly')) return 'friendly';
  return 'league';
}
