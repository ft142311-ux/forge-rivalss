import { evaluateCanonicalDocuments } from './season-canonical.ts';
import { expectedRolloverGroups, validateRolloverPlan } from './season-rollover-plan.ts';
import { getTableId, generateSeasonCalendar, TOTAL_GROUPS, TEAMS_PER_GROUP } from '../lib/leagues-data.ts';

const LEAGUE_ID = 'ALPHA';
const CALENDAR_REVISION = 4;

export type SeasonRecoveryDocument = { id: string; data: Record<string, any> };
export type SeasonTwoRecoveryDocument = SeasonRecoveryDocument;

/** Run async tasks with a fixed worker count while preserving fail-fast Promise.all behavior. */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await task(items[index]);
    }
  });
  await Promise.all(workers);
}


/** Build a canonical season from the immediately prior validated placement plan. */
export function buildSeasonRecoveryDocuments(plan: any, sourceSeason: number, targetSeason: number, seasonStart: Date) {
  const planValidation = validateRolloverPlan(plan, sourceSeason, targetSeason);
  if (!planValidation.valid) throw new Error(planValidation.reason || 'SEASON_2_ROLLOVER_PLAN_INVALID');
  if (targetSeason !== sourceSeason + 1 || !(seasonStart instanceof Date) || !Number.isFinite(seasonStart.getTime())) {
    throw new Error('SEASON_RECOVERY_TARGET_OR_START_INVALID');
  }

  const tables: SeasonRecoveryDocument[] = [];
  const slots: SeasonRecoveryDocument[] = [];
  const matches: SeasonRecoveryDocument[] = [];
  const allIds = new Set<string>();

  for (const key of expectedRolloverGroups()) {
    const match = /^D([1-4])-G(\d+)$/.exec(key);
    if (!match) throw new Error('SEASON_RECOVERY_GROUP_KEY_INVALID');
    const level = Number(match[1]);
    const group = Number(match[2]);
    const teams = [...plan.groups[key]].sort((a: any, b: any) => Number(a.rank) - Number(b.rank));
    if (teams.length !== TEAMS_PER_GROUP || teams.some((team: any, index: number) =>
      !team?.id || Number(team.rank) !== index + 1 || allIds.has(String(team.id)))) {
      throw new Error(`SEASON_RECOVERY_PARTICIPANTS_INVALID:${targetSeason}:${key}`);
    }
    for (const team of teams) allIds.add(String(team.id));

    const stats = Object.fromEntries(teams.map((team: any, index: number) => [String(team.id), {
      ...team,
      id: String(team.id),
      name: String(team.name || team.id),
      rank: index + 1,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      diff: 0,
    }]));
    const tableId = getTableId(targetSeason, LEAGUE_ID, level, group);
    tables.push({ id: tableId, data: {
      id: tableId,
      leagueId: LEAGUE_ID,
      level,
      group,
      season: targetSeason,
      stats,
      version: 140,
      scheduleRevision: CALENDAR_REVISION,
    } });

    teams.forEach((team: any, index: number) => {
      const rank = index + 1;
      const isHuman = !String(team.id).startsWith('BOT_');
      slots.push({ id: `S${targetSeason}_L${LEAGUE_ID}_D${level}_G${group}_R${rank}`, data: {
        season: targetSeason,
        leagueId: LEAGUE_ID,
        division: level,
        group,
        rank,
        status: isHuman ? 'OCCUPIED' : 'FREE',
        occupantId: isHuman ? String(team.id) : null,
      } });
    });

    const calendar = generateSeasonCalendar(teams, targetSeason, LEAGUE_ID, seasonStart);
    for (const fixture of calendar) {
      const id = `match_v140_S${targetSeason}_L${LEAGUE_ID}_V${level}_G${group}_T${fixture.tour}_R${fixture.homeRank}_vs_R${fixture.awayRank}`;
      matches.push({ id, data: {
        ...fixture,
        id,
        level,
        groupId: group,
        leagueId: LEAGUE_ID,
        season: targetSeason,
        version: 140,
        calendarRevision: CALENDAR_REVISION,
        status: 'scheduled',
        matchType: 'league',
      } });
    }
  }

  if (tables.length !== TOTAL_GROUPS || slots.length !== TOTAL_GROUPS * TEAMS_PER_GROUP || matches.length !== TOTAL_GROUPS * TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1)) {
    throw new Error(`SEASON_RECOVERY_CALENDAR_SIZE_INVALID:${targetSeason}`);
  }
  const readiness = evaluateCanonicalDocuments({ tables: tables.map(x => x.data), slots: slots.map(x => x.data), matches: matches.map(x => x.data) });
  if (!readiness.ready) throw new Error(`SEASON_RECOVERY_CALENDAR_INVALID:${targetSeason}:${readiness.reasons.join(',')}`);
  return { tables, slots, matches, readiness };
}

/** Compatibility wrapper for the original S1→S2 recovery tests/callers. */
export function buildSeasonTwoRecoveryDocuments(plan: any, seasonStart: Date) {
  return buildSeasonRecoveryDocuments(plan, 1, 2, seasonStart);
}

export function isValidSeasonTwoRecoveryResult(match: any) {
  const home = Number(match?.seriesScore?.home ?? match?.score?.home ?? match?.scoreA);
  const away = Number(match?.seriesScore?.away ?? match?.score?.away ?? match?.scoreB);
  return match?.isFinished === true && String(match?.status || '').toLowerCase() === 'finished' &&
    Number.isInteger(home) && Number.isInteger(away) && home >= 0 && home <= 2 && away >= 0 && away <= 2 && home + away > 0;
}
