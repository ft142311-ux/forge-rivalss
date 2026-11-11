import { TOURNAMENT_RULES } from './config';
import type { TournamentRuleSet } from './types';

export function getTournamentRuleSet(id: string): TournamentRuleSet {
  return TOURNAMENT_RULES.find(rule => rule.id === id) || TOURNAMENT_RULES[1];
}

export function canEnterTournament(rule: TournamentRuleSet, participantCount: number) {
  if (rule.minParticipants && participantCount < rule.minParticipants) return false;
  if (rule.maxParticipants && participantCount > rule.maxParticipants) return false;
  return true;
}

export function associationPairWinner(homeWins: number, awayWins: number, homeDiff: number, awayDiff: number, homeCriterion = 0, awayCriterion = 0) {
  if (homeWins !== awayWins) return homeWins > awayWins ? 'home' : 'away';
  if (homeDiff !== awayDiff) return homeDiff > awayDiff ? 'home' : 'away';
  return homeCriterion >= awayCriterion ? 'home' : 'away';
}

export interface TournamentPair { homeId: string; awayId: string; round: number; bye?: boolean; }
export function buildOlympicPairs(participantIds: string[], round = 1): TournamentPair[] {
  const ids = [...participantIds];
  const pairs: TournamentPair[] = [];
  for (let i=0;i<ids.length;i+=2) {
    const homeId = ids[i]; const awayId = ids[i+1];
    if (!awayId) pairs.push({homeId, awayId:'BYE', round, bye:true});
    else pairs.push({homeId, awayId, round});
  }
  return pairs;
}

export function validateRoundSubstitutions(previousStarterIds: string[], nextStarterIds: string[], substitutionsPerRound = 1) {
  const a = new Set(previousStarterIds); const b = new Set(nextStarterIds);
  let changed = 0;
  for (const id of a) if (!b.has(id)) changed++;
  return changed <= Math.max(0, substitutionsPerRound);
}

export function associationMatchWinner(pairResults: Array<{homePoints:number;awayPoints:number}>, homeExtra = 0, awayExtra = 0) {
  const homeWins = pairResults.filter(x=>x.homePoints>x.awayPoints).length;
  const awayWins = pairResults.filter(x=>x.awayPoints>x.homePoints).length;
  const homeDiff = pairResults.reduce((s,x)=>s+x.homePoints-x.awayPoints,0);
  const awayDiff = -homeDiff;
  return associationPairWinner(homeWins, awayWins, homeDiff+homeExtra, awayDiff+awayExtra, homeExtra, awayExtra);
}
