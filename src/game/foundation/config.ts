import type { FoundationRole, FoundationTactics, TournamentRuleSet, TrainingSkill } from './types';
export { FOUNDATION_SKILLS } from './skills';

export const ROLE_SKILL_WEIGHTS: Record<FoundationRole, Partial<Record<TrainingSkill, number>>> = {
  Midlaner: { reflexes: .24, lastHitting: .22, ganking: .20, positioning: .18, tiltResistance: .16 },
  Carry: { lastHitting: .26, positioning: .22, reflexes: .20, tiltResistance: .17, versatility: .15 },
  Tank: { mapAwareness: .18, positioning: .22, objectiveControl: .25, tiltResistance: .17, versatility: .18 },
  Jungler: { ganking: .25, objectiveControl: .22, mapAwareness: .20, reflexes: .18, versatility: .15 },
  Support: { communication: .24, objectiveControl: .20, positioning: .18, mapAwareness: .18, tiltResistance: .20 },
};

export const DEFAULT_TACTICS: FoundationTactics = {
  direction: 'mid', style: 'control', pressing: 'medium', rigidity: 'medium', tempo: 'medium', risk: 'balanced', range: 'medium'
};

export const TRAINING_RULES = {
  basePer90: .35,
  propensityWeight: .55,
  physicalWeight: .35,
  resilienceWeight: .25,
  capSlowdownAt: .90,
  capSlowdownFactor: .25,
  youngAge: 22,
  primeAge: 25,
  declineAge: 29,
  maxAge: 35,
};

export const STAFF_BONUSES = {
  coach: { training: .08, match: .01 },
  analyst: { match: .015, scouting: .05 },
  scout: { scouting: .10, youth: .08 },
  doctor: { injury: .12, recovery: .10 },
  financier: { economy: .05 },
};

export const TOURNAMENT_RULES: TournamentRuleSet[] = [
  { id: 'association-cup', name: 'Кубок ассоциаций', format: 'association_cup', bestOf: 1, minParticipants: 25, substitutionsPerRound: 1 },
  { id: 'open-olympic', name: 'Открытый турнир', format: 'olympic', bestOf: 1, substitutionsPerRound: 1, minRoundsBetweenAppearances: 5 },
  { id: 'open-group', name: 'Открытый турнир: группы', format: 'group_olympic', bestOf: 1, substitutionsPerRound: 1 },
  { id: 'friendly', name: 'Товарищеский матч', format: 'friendly', bestOf: 1 },
];

export const FOUNDATION_COLLECTIONS = {
  managers: 'players_v14',
  matches: 'matches_v2',
  market: 'market_v7',
  tournaments: 'tournaments_v2',
  tournamentMatches: 'tournament_matches_v2',
  events: 'random_events_v1',
  awards: 'player_awards_v1',
  staff: 'staff_v2',
  associations: 'associations_v4',
  fanSnapshots: 'fan_snapshots_v1',
  economy: 'economy_transactions',
  cycles: 'foundation_cycles_v1',
} as const;
