'use server';

/**
 * Compatibility adapter. All callers still use simulateMobaMatch(), but the
 * actual result now comes from the single Forge-Rivals Match Core v5.
 */
import { z } from 'zod';
import { runMatchEngine } from '@/app/lib/match-engine';
import { PLAYER_SKILL_KEYS, type PlayerSkillKey } from '@/game/player-skills';

const ProStatsSchema = z.object(
  Object.fromEntries(PLAYER_SKILL_KEYS.map((skill) => [skill, z.number()])) as Record<PlayerSkillKey, z.ZodNumber>
);
const PlayerSchema = z.object({
  id:z.string().optional(), name:z.string(), role:z.string(), overallRating:z.number(), image:z.string().optional(),
  isPro:z.boolean().optional(), proStats:ProStatsSchema, isSub:z.boolean().optional(), form:z.number().optional(),
  fatigue:z.number().optional(), currentRole:z.string().optional(), tilt:z.number().optional(), chemistryMatches:z.number().optional()
});
const TeamSchema = z.object({
  name:z.string(), heroes:z.array(PlayerSchema), strategy:z.string().optional().default('Balanced Play'),
  infraBonus:z.number().optional(), staffBonus:z.number().optional(), analystBonus:z.number().optional(), synergy:z.number().optional(),
  tactics:z.any().optional()
});
export const SimulateMobaMatchInputSchema = z.object({
  teamA:TeamSchema, teamB:TeamSchema, isBo2:z.boolean().default(true), isBo3:z.boolean().default(false),
  scoreA:z.number().optional(), scoreB:z.number().optional(), matchId:z.string().optional()
});
export type SimulateMobaMatchInput=z.infer<typeof SimulateMobaMatchInputSchema>;

export async function simulateMobaMatch(input:SimulateMobaMatchInput){
  const bestOf=input.isBo3?3:(input.isBo2?2:1) as 1|2|3;
  const result=runMatchEngine({
    mode: 'friendly',
    matchId:input.matchId||`compat:${input.teamA.name}:${input.teamB.name}`,
    teamA:{name:input.teamA.name,players:input.teamA.heroes,strategy:input.teamA.strategy,tactics:input.teamA.tactics,staffBonus:input.teamA.staffBonus,analystBonus:input.teamA.analystBonus,infraBonus:input.teamA.infraBonus,synergy:input.teamA.synergy},
    teamB:{name:input.teamB.name,players:input.teamB.heroes,strategy:input.teamB.strategy,tactics:input.teamB.tactics,staffBonus:input.teamB.staffBonus,analystBonus:input.teamB.analystBonus,infraBonus:input.teamB.infraBonus,synergy:input.teamB.synergy},
    bestOf,
    existingScore:input.scoreA!==undefined&&input.scoreB!==undefined?{a:input.scoreA,b:input.scoreB}:undefined
  });
  return {winner:result.winner||'Ничья',seriesScore:result.seriesScore,games:result.games.map(g=>({scoreA:g.homeScore,scoreB:g.awayScore,duration:g.duration,mvp:g.mvp,matchSummary:g.matchSummary,towersA:g.towersA,towersB:g.towersB,objectivesA:g.objectivesA,objectivesB:g.objectivesB,teamAOvr:result.homeOverall,teamBOvr:result.awayOverall,timeline:g.timeline.map(e=>({time:e.minute,event:e.text,type:e.type||'swing',score:e.score})),scoreboard:g.scoreboard,teamComparison:{farm:g.teamComparison.farm,tactics:g.teamComparison.tactics,teamwork:g.teamComparison.teamwork,reflexes:g.teamComparison.reflexes}}))};
}
