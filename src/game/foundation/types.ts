import type { PlayerSkillKey } from '../player-skills';

export const FOUNDATION_VERSION = 1 as const;

export type FoundationRole = 'Carry' | 'Midlaner' | 'Tank' | 'Jungler' | 'Support';
export type LaneDirection = 'easy' | 'mid' | 'hard';
export type TrainingSkill = PlayerSkillKey;
export type TacticalStyle = 'offense' | 'control';
export type TacticalPressing = 'low' | 'medium' | 'high';
export type TacticalRigidity = 'low' | 'medium' | 'high';
export type TacticalTempo = 'slow' | 'medium' | 'fast';
export type TacticalRisk = 'cautious' | 'balanced' | 'aggressive';
export type TacticalRange = 'close' | 'medium' | 'long';

export interface FoundationTactics {
  direction: LaneDirection;
  style: TacticalStyle;
  pressing: TacticalPressing;
  rigidity: TacticalRigidity;
  tempo: TacticalTempo;
  risk: TacticalRisk;
  range: TacticalRange;
}

export interface FoundationPlayerState {
  id: string;
  role: FoundationRole;
  currentRole?: FoundationRole;
  overallRating?: number;
  form: number;
  fatigue: number;
  age: number;
  salary: number;
  isInjured?: boolean;
  injuredUntil?: string | null;
  tilt?: number;
  suspensionUntil?: string | null;
  warningCount?: number;
  chemistryMatches?: number;
  lineupMatches?: number;
  trainingFocus?: TrainingSkill | null;
  dailyTrainingFocus?: TrainingSkill | null;
  trainingProgress?: Partial<Record<TrainingSkill, number>>;
  skillCaps?: Partial<Record<TrainingSkill, number>>;
  skillInclinations?: Partial<Record<TrainingSkill, number>>;
  proStats: Record<TrainingSkill, number>;
  proTalents: Record<TrainingSkill, number>;
  lastMatchMinutes?: number;
  trainingPropensity?: number;
  physical?: number;
  resilience?: number;
}

export interface FoundationManagerState {
  id: string;
  credits: number;
  crystals: number;
  ownedPlayers: FoundationPlayerState[];
  lineup?: Record<string, string | null>;
  tactics?: Partial<FoundationTactics>;
  strategy?: string;
  staff?: Record<string, any>;
  buildings?: Record<string, any>;
  fans?: FoundationFansState;
  associationId?: string | null;
  licenses?: Record<string, any>;
  managerLevel?: number;
}

export interface FoundationFansState {
  mood: number;
  communitySize: number;
  attendanceLast3: number[];
  attendance: number;
  freeEntry?: boolean;
  awayTrip?: boolean;
  autographSession?: boolean;
}

export interface TrainingResult {
  playerId: string;
  skill: TrainingSkill;
  oldValue: number;
  newValue: number;
  progress: number;
  cap: number;
  gain: number;
  minutes: number;
  slowedByCap: boolean;
}

export interface MatchInputState {
  player: FoundationPlayerState;
  role: FoundationRole;
  tactics: FoundationTactics;
  synergy: number;
  opponentSkill?: number;
}

export interface TournamentRuleSet {
  id: string;
  name: string;
  format: 'association_cup' | 'olympic' | 'group_olympic' | 'friendly' | 'open';
  bestOf: 1 | 2 | 3 | 5;
  maxParticipants?: number;
  minParticipants?: number;
  substitutionsPerRound?: number;
  minRoundsBetweenAppearances?: number;
}
