import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { prepareSeasonRollover } from './season-rollover';
import { acquireSeasonCalendarBuildLock, assertSeasonCalendarBuildLock, commitSeasonCalendarPublication, commitSeasonCalendarWrites, releaseSeasonCalendarBuildLock } from './season-rollover-lock';
import { validateRolloverPlan } from './season-rollover-plan';
import { evaluateCanonicalDocuments } from './season-canonical';
import { inspectGroupReconciliation } from './season-rollover-standings';
import { getAdminDb } from '@/lib/firebase-admin';
import { advanceAtMostOneSeasonBoundary, canPrepareImmediateCatchUpTarget, deriveSeasonDatePlan, evaluateExpiredSeasonArchives, resolveCanonicalSeasonDateWindow, resolveNextSeasonTarget, resolveSeasonActivationWindow, resolveSeasonLifecycleWindow } from './season-boundary';
import { FIRST_SEASON_NEXT_START_ISO } from '@/app/lib/time-utils';
import { isCompletedSeasonArchive, isRecoveredSeasonArchive, validateSeasonArchiveSnapshot } from './season-archive';
import { buildBotClub } from './bot-roster';
import {
  MAX_LEVELS,
  TEAMS_PER_GROUP,
  TOTAL_GROUPS,
  getTableId,
  getBotId,
  getBotName,
  generateSeasonCalendar,
  TOTAL_CYCLE_DAYS,
} from '@/app/lib/leagues-data';

const LEAGUE_ID = 'ALPHA';
const CALENDAR_REVISION = 4;
const FIRST_SEASON_START_ISO = '2026-09-21T15:00:00.000Z'; // 18:00 MSK
const BATCH_LIMIT = 450;

function getGroupCoordinates(index: number) {
  let tier = 1;
  let runningTotal = 0;
  while (tier <= MAX_LEVELS) {
    const groupsInTier = Math.pow(2, tier - 1);
    if (index <= runningTotal + groupsInTier) {
      return { tier, group: index - runningTotal };
    }
    runningTotal += groupsInTier;
    tier++;
  }
  return { tier: MAX_LEVELS, group: Math.pow(2, MAX_LEVELS - 1) };
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getInitialStats(tier: number, group: number) {
  const stats: Record<string, any> = {};
  for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
    const id = getBotId(LEAGUE_ID, tier, group, rank);
    stats[id] = {
      id,
      name: getBotName(tier, group, rank),
      rank,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      diff: 0,
      isBot: true,
    };
  }
  return stats;
}

/**
 * A table is canonical only when it contains exactly one team for each rank 1..8.
 * Legacy/corrupt rows (including a ninth unranked or duplicate-rank team) must not
 * keep worldReady=false forever. During a season build, standings counters are reset;
 * team identity is retained for valid ranked entries and missing ranks become bots.
 */
/**
 * Remove legacy/non-canonical rows from an existing season table without
 * changing standings counters or inventing replacement participants. Each
 * rank 1..8 may have only one row; a real club wins over a duplicate bot row.
 */
function stripNonCanonicalRows(source: Record<string, any>) {
  const byRank = new Map<number, { id: string; row: any }>();
  for (const [key, value] of Object.entries(source || {})) {
    const row: any = value || {};
    const rank = Number(row.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > TEAMS_PER_GROUP) continue;
    const id = String(row.id || key);
    const existing = byRank.get(rank);
    if (!existing || (existing.id.startsWith('BOT_') && !id.startsWith('BOT_'))) {
      byRank.set(rank, { id, row });
    }
  }

  const result: Record<string, any> = {};
  for (const [rank, entry] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    result[entry.id] = { ...entry.row, id: entry.id, rank };
  }
  return result;
}

/**
 * Repair only invalid/duplicate ranks in the active season's persisted tables.
 * This is intentionally narrow: it preserves valid rows and all counters,
 * rather than resetting standings before season rollover has been archived.
 */
type BuildLease = {
  assert: () => Promise<void>;
  commit: (writes: Array<{ ref: any; data: any; options?: any }>) => Promise<void>;
};

async function inspectCalendarRepairPreflight(db: any, seasonNumber: number) {
  const [tablesSnap, matchesSnap, slotsSnap] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', seasonNumber).where('version', '==', 140).get(),
    db.collection('matches_v2').where('season', '==', seasonNumber).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', seasonNumber).where('leagueId', '==', LEAGUE_ID).get(),
  ]);
  const validation = evaluateCanonicalDocuments({ tables: tablesSnap.docs, slots: slotsSnap.docs, matches: matchesSnap.docs });
  return { ready: validation.ready, diagnostics: validation.reasons.map(reason => ({ reason })) };
}

async function repairCanonicalSeasonTables(db: any, seasonNumber: number, lease: BuildLease) {
  const [snapshot, matchesSnapshot, slotsSnapshot] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', seasonNumber).where('version', '==', 140).get(),
    db.collection('matches_v2').where('season', '==', seasonNumber).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', seasonNumber).where('leagueId', '==', LEAGUE_ID).get(),
  ]);

  if (snapshot.empty && matchesSnapshot.empty && slotsSnapshot.empty) return 0;
  const canonicalValidation = evaluateCanonicalDocuments({ tables: snapshot.docs, slots: slotsSnapshot.docs, matches: matchesSnapshot.docs });
  if (!canonicalValidation.ready) {
    throw new Error(`SEASON_CALENDAR_REPAIR_PREFLIGHT_FAILED:${canonicalValidation.reasons.join(',')}`);
  }

  let writes: Array<{ ref: any; data: any; options?: any }> = [];
  let batchCount = 0;
  let repairedTables = 0;

  const commitBatch = async () => {
    if (batchCount === 0) return;
    await lease.commit(writes);
    writes = [];
    batchCount = 0;
  };

  for (const tableDoc of snapshot.docs) {
    const data = tableDoc.data() || {};
    const tier = Number(data.level);
    const group = Number(data.group);
    if (!Number.isInteger(tier) || tier < 1 || tier > MAX_LEVELS ||
        !Number.isInteger(group) || group < 1 || group > Math.pow(2, tier - 1)) {
      continue;
    }

    const originalStats = data.stats && typeof data.stats === 'object' ? data.stats : {};
    const fixtures = matchesSnapshot.docs
      .map((doc: any) => doc.data() || {})
      .filter((match: any) => Number(match.level || match.division || 0) === tier && Number(match.groupId || match.group || 0) === group);
    const slots = slotsSnapshot.docs
      .map((doc: any) => doc.data() || {})
      .filter((slot: any) => Number(slot.division || slot.level || 0) === tier && Number(slot.group || 0) === group);
    const inspection = inspectGroupReconciliation(originalStats, fixtures, slots, TEAMS_PER_GROUP);
    const normalizedStats = inspection.completeFixtures
      ? Object.fromEntries(inspection.standings.map(row => [String(row.id), row]))
      : stripNonCanonicalRows(originalStats);
    if (JSON.stringify(originalStats) === JSON.stringify(normalizedStats)) continue;

    writes.push({ ref: tableDoc.ref, data: {
      stats: normalizedStats,
      updatedAt: FieldValue.serverTimestamp(),
    }, options: { merge: true } });
    batchCount++;
    repairedTables++;
    if (batchCount >= BATCH_LIMIT) await commitBatch();
  }

  await commitBatch();
  return repairedTables;
}

function normalizeGroupStats(
  source: Record<string, any>,
  tier: number,
  group: number,
  resetCounters: boolean,
) {
  const candidates = new Map<number, { id: string; row: any }>();
  for (const [key, value] of Object.entries(source || {})) {
    const row: any = value || {};
    const rank = Number(row.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > TEAMS_PER_GROUP) continue;
    const id = String(row.id || key);
    const existing = candidates.get(rank);
    // Keep a real club over a bot if duplicate rows claim the same rank.
    if (!existing || (String(existing.id).startsWith('BOT_') && !id.startsWith('BOT_'))) {
      candidates.set(rank, { id, row });
    }
  }

  const normalized: Record<string, any> = {};
  for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
    const candidate = candidates.get(rank);
    const fallbackId = getBotId(LEAGUE_ID, tier, group, rank);
    const id = candidate?.id || fallbackId;
    const row = candidate?.row || { id, name: getBotName(tier, group, rank), isBot: true };
    normalized[id] = {
      ...row,
      id,
      name: String(row.name || row.clubName || getBotName(tier, group, rank)),
      rank,
      matchesPlayed: resetCounters ? 0 : Math.max(0, Number(row.matchesPlayed) || 0),
      wins: resetCounters ? 0 : Math.max(0, Number(row.wins) || 0),
      draws: resetCounters ? 0 : Math.max(0, Number(row.draws) || 0),
      losses: resetCounters ? 0 : Math.max(0, Number(row.losses) || 0),
      points: resetCounters ? 0 : Math.max(0, Number(row.points) || 0),
      diff: resetCounters ? 0 : Number(row.diff) || 0,
    };
  }
  return normalized;
}

function getTeamsFromStats(stats: Record<string, any>, tier: number, group: number) {
  const byRank = new Map<number, any>();
  for (const team of Object.values(stats || {})) {
    const rank = Number((team as any)?.rank);
    if (rank >= 1 && rank <= TEAMS_PER_GROUP && !byRank.has(rank)) {
      byRank.set(rank, team);
    }
  }

  return Array.from({ length: TEAMS_PER_GROUP }, (_, index) => {
    const rank = index + 1;
    const existing = byRank.get(rank);
    if (existing) {
      return {
        id: existing.id,
        name: existing.name || getBotName(tier, group, rank),
        rank,
      };
    }

    const id = getBotId(LEAGUE_ID, tier, group, rank);
    return { id, name: getBotName(tier, group, rank), rank };
  });
}


async function ensureBotClubs(db: any, teams: any[], state: { count: number; set: (ref: any, data: any) => void; commit: () => Promise<void> }) {
  for (const team of teams) {
    const id = String(team?.id || '');
    if (!id.startsWith('BOT_')) continue;
    const ref = db.collection('players_v14').doc(id);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() || {} : {};
    const roster = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
    const valid = snap.exists && roster.length === 5 && roster.every((p: any) => {
      const ovr = Number(p?.overallRating ?? p?.ovr);
      return Number.isFinite(ovr) && ovr >= 23 && ovr <= 27 && p?.proStats && typeof p.proStats === 'object';
    });
    if (!valid) {
      state.set(ref, buildBotClub(id, String(team?.name || id)));
      if (state.count >= BATCH_LIMIT) await state.commit();
    }
  }
}

/**
 * Idempotent season/calendar bootstrap.
 * It repairs missing matches and prepares the next season without deleting
 * existing clubs or table data.
 */
async function buildSeasonCalendar(lease: BuildLease, pristineFirstWorld = false) {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await configRef.get();
  const current = configSnap.exists ? configSnap.data() || {} : {};

  // Strip stale rank-9/duplicate rows before rollover reads the official table.
  // This preserves scores and the existing eight canonical ranks.
  const sourceSeasonNumber = Number(current.activeSeasonNumber || 1);
  const recoveryTarget = Number(current.recoveryTargetSeason || 0);
  const directRecovery = recoveryTarget === sourceSeasonNumber + 2;
  const repairedSourceTables = directRecovery ? 0 : await repairCanonicalSeasonTables(db, sourceSeasonNumber, lease);

  const now = new Date();
  let seasonNumber = Number(current.activeSeasonNumber || 1);
  let seasonStart = current.seasonStart
    ? new Date(current.seasonStart)
    : pristineFirstWorld
      ? now
      : new Date(FIRST_SEASON_START_ISO);

  if (Number.isNaN(seasonStart.getTime())) {
    seasonStart = new Date(FIRST_SEASON_START_ISO);
  }

  // The persisted nextSeasonStart is the canonical boundary for the transition
  // currently being recovered. S1 -> S2 was explicitly scheduled for Oct 8,
  // while later seasons follow TOTAL_CYCLE_DAYS. Do not recalculate that first
  // boundary as Oct 6 merely because the normal cadence is 15 days.
  const configuredNextStart = current.nextSeasonStart ? new Date(current.nextSeasonStart) : null;
  const validConfiguredNextStart = configuredNextStart && Number.isFinite(configuredNextStart.getTime()) && configuredNextStart.getTime() > seasonStart.getTime();
  let nextBoundary = validConfiguredNextStart
    ? configuredNextStart!
    : pristineFirstWorld
      ? addDays(seasonStart, TOTAL_CYCLE_DAYS)
      : seasonNumber === 1
        ? new Date(FIRST_SEASON_NEXT_START_ISO)
        : addDays(seasonStart, TOTAL_CYCLE_DAYS);

  // Advance at most one season boundary per invocation. A delayed cron must
  // never jump S1 -> S3 (or farther) and bypass the S1 -> S2 archive, standings,
  // and publication gates. Subsequent orchestrator runs can catch up one season
  // at a time after each target season is fully published.
  if (!pristineFirstWorld) {
    const boundaryStep = advanceAtMostOneSeasonBoundary(seasonNumber, seasonStart, nextBoundary, now, TOTAL_CYCLE_DAYS);
    seasonNumber = boundaryStep.seasonNumber;
    seasonStart = boundaryStep.seasonStart;
    nextBoundary = boundaryStep.nextBoundary;
  }

  if (directRecovery) {
    // Recovery is allowed to bypass an unavailable intermediate season only
    // after its explicit recovered archive and carry-forward plan were written.
    let sourceTargetStart = new Date(FIRST_SEASON_NEXT_START_ISO);
    for (let season = 2; season < recoveryTarget; season++) sourceTargetStart = addDays(sourceTargetStart, TOTAL_CYCLE_DAYS);
    seasonNumber = recoveryTarget;
    seasonStart = sourceTargetStart;
    nextBoundary = addDays(seasonStart, TOTAL_CYCLE_DAYS);
  }

  const phase = String(current.phase || '').toUpperCase();
  const requestedTarget = Number(current.nextSeasonNumber || current.preparationTargetSeason || 0);
  const transitionRequested = ['FINALIZING', 'GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED'].includes(phase) || (phase === 'WORLD_BUILDING' && requestedTarget > Number(current.activeSeasonNumber || 1));
  if (transitionRequested) {
    // A stale/corrupt target must never jump over an intermediate season.
    // Each season requires its own archive, standings, calendar and publication gates.
    const forcedTarget = resolveNextSeasonTarget(Number(current.activeSeasonNumber || 1), requestedTarget);
    if (forcedTarget > seasonNumber) {
      seasonNumber = forcedTarget;
      // Keep the already scheduled boundary, even if recovery happens late.
      const storedBoundary = current.nextSeasonStart ? new Date(current.nextSeasonStart) : null;
      const dateDerivedStart = storedBoundary && Number.isFinite(storedBoundary.getTime()) && storedBoundary.getTime() > new Date(current.seasonStart || seasonStart).getTime()
        ? storedBoundary
        : (Number(current.activeSeasonNumber || 1) === 1 ? new Date(FIRST_SEASON_NEXT_START_ISO) : addDays(new Date(current.seasonStart || seasonStart), TOTAL_CYCLE_DAYS));
      seasonStart = dateDerivedStart;
      nextBoundary = addDays(seasonStart, TOTAL_CYCLE_DAYS);
    }
  }

  // Persist the same boundary used by the transition logic. Season 1 has an
  // explicit Oct 8, 2026 boundary; recomputing from the generic 15-day cadence
  // would incorrectly shift it to Oct 6 and desynchronize every gate.
  const nextSeasonStart = nextBoundary;
  const seasonChanged =
    Number(current.activeSeasonNumber || 1) !== seasonNumber ||
    String(current.seasonStart || '') !== seasonStart.toISOString();
  const needsRepair = Number(current.calendarRevision || 0) !== CALENDAR_REVISION;

  // Never switch active seasons until the previous season is complete, archived,
  // and its promotion/relegation plan has been written. This protects standings
  // and prevents the next season from silently reverting to the initial bot table.
  let rolloverPlan: any = null;
  const activeSeasonBefore = Number(current.activeSeasonNumber || 1);
  if (configSnap.exists && seasonChanged && seasonNumber > activeSeasonBefore) {
    const planSourceSeason = directRecovery ? seasonNumber - 1 : activeSeasonBefore;
    const planSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
    const savedPlan = planSnap.exists ? planSnap.data() || {} : null;
    if (savedPlan && validateRolloverPlan(savedPlan, planSourceSeason, seasonNumber).valid && (!directRecovery || savedPlan.mode === 'recovery_carry_forward')) {
      rolloverPlan = savedPlan;
    } else {
      if (directRecovery) return { success: false, seasonNumber: activeSeasonBefore, targetSeasonNumber: seasonNumber, worldReady: false, waitingForSeasonResults: true, rollover: { ready: false, reason: 'RECOVERY_CARRY_FORWARD_PLAN_INVALID' }, writesStarted: false };
      const rollover = await prepareSeasonRollover(db, activeSeasonBefore, seasonNumber);
      if (!rollover.ready) {
        return {
          success: false, seasonNumber: activeSeasonBefore,
          targetSeasonNumber: seasonNumber, worldReady: false,
          waitingForSeasonResults: true, rollover,
          repairedSourceTables,
          createdMatches: 0, repairedMatches: 0,
          totalExpectedMatches: TOTAL_GROUPS * TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1),
          totalExpectedSlots: TOTAL_GROUPS * TEAMS_PER_GROUP,
        };
      }
      const preparedPlanSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
      const preparedPlan = preparedPlanSnap.exists ? preparedPlanSnap.data() || {} : null;
      if (!validateRolloverPlan(preparedPlan, activeSeasonBefore, seasonNumber).valid) {
        return {
          success: false, seasonNumber: activeSeasonBefore,
          targetSeasonNumber: seasonNumber, worldReady: false,
          waitingForSeasonResults: true,
          rollover: { ready: false, reason: 'ROLLOVER_PLAN_NOT_PERSISTED', sourceSeason: activeSeasonBefore, targetSeason: seasonNumber },
          repairedSourceTables,
          createdMatches: 0, repairedMatches: 0,
          totalExpectedMatches: TOTAL_GROUPS * TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1),
          totalExpectedSlots: TOTAL_GROUPS * TEAMS_PER_GROUP,
        };
      }
      rolloverPlan = preparedPlan;
    }
  } else if (configSnap.exists && current.worldReady !== true && seasonNumber > 1) {
    // Recover an interrupted build. The previous run may already have advanced
    // activeSeasonNumber before all tables/slots/matches were committed.
    const planSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
    const savedPlan = planSnap.exists ? planSnap.data() || {} : null;
    if (validateRolloverPlan(savedPlan, seasonNumber - 1, seasonNumber).valid) {
      rolloverPlan = savedPlan;
    }
  }

  // The active world remains registration-ready while the next world is built.
  // Prepared readiness is tracked separately and becomes true only after all
  // 15 groups, 120 slots and 840 matches pass the canonical gate.
  if (seasonChanged || needsRepair || !configSnap.exists) {
    await lease.commit([{ ref: configRef, data: {
      // Preserve all active-season fields. These prepared fields describe only
      // the target calendar and must not disable registration in the active world.
      ...(seasonNumber > activeSeasonBefore ? {
        activeSeasonNumber: activeSeasonBefore,
        phase: 'GENERATING_NEXT',
        preparedSeasonNumber: seasonNumber,
        preparedSeasonStart: seasonStart.toISOString(),
        preparedNextSeasonStart: nextSeasonStart.toISOString(),
        preparedCalendarRevision: CALENDAR_REVISION,
        preparedWorldReady: current.preparedWorldReady === true && Number(current.preparedSeasonNumber) === seasonNumber,
        preparedPublished: current.preparedPublished === true && Number(current.preparedSeasonNumber) === seasonNumber,
      } : {
        activeSeasonNumber: seasonNumber,
        phase: String(current.phase || 'REGULAR_SEASON'),
        worldReady: false,
        seasonStart: seasonStart.toISOString(),
        nextSeasonStart: nextSeasonStart.toISOString(),
        calendarRevision: CALENDAR_REVISION,
      }),
      rebuildStatus: 'STAGE_3A8_COMPLETE',
      rebuildError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, options: { merge: true } }]);
  }

  // Build/repair all 15 groups. Writes are split below 500 operations.
  let writes: Array<{ ref: any; data: any; options?: any }> = [];
  const batch = { set: (ref: any, data: any, options?: any) => writes.push({ ref, data, options }) };
  let batchCount = 0;
  let createdMatches = 0;
  let repairedMatches = 0;

  const commitBatch = async () => {
    if (batchCount === 0) return;
    await lease.commit(writes);
    writes = [];
    batchCount = 0;
  };

  for (let index = 1; index <= TOTAL_GROUPS; index++) {
    const { tier, group } = getGroupCoordinates(index);
    const tableId = getTableId(seasonNumber, LEAGUE_ID, tier, group);
    const tableRef = db.collection('league_tables_v2').doc(tableId);
    const tableSnap = await tableRef.get();
    const tableData = tableSnap.exists ? tableSnap.data() || {} : {};
    const seededTeams = rolloverPlan?.groups?.[`D${tier}-G${group}`];
    const seededStats: Record<string, any> = {};
    if (Array.isArray(seededTeams)) seededTeams.forEach((team: any, i: number) => { seededStats[String(team.id)] = { ...team, id: String(team.id), rank: i + 1, matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0 }; });
    const rawStats = rolloverPlan && Object.keys(seededStats).length === TEAMS_PER_GROUP
      ? seededStats
      : (tableSnap.exists ? (tableData.stats || {}) : (Object.keys(seededStats).length === TEAMS_PER_GROUP ? seededStats : getInitialStats(tier, group)));
    // If the world is not yet published, this is a build/repair pass. Never let
    // stale results from a previous season leak into the new season's standings.
    const resetCounters = current.worldReady !== true || Boolean(rolloverPlan);
    const stats = normalizeGroupStats(rawStats, tier, group, resetCounters);
    const teams = getTeamsFromStats(stats, tier, group);

    if (!tableSnap.exists) {
      batch.set(tableRef, {
        id: tableId,
        leagueId: LEAGUE_ID,
        level: tier,
        group,
        season: seasonNumber,
        stats,
        version: 140,
        scheduleRevision: CALENDAR_REVISION,
        createdAt: FieldValue.serverTimestamp(),
      });
      batchCount++;
    } else if (
      JSON.stringify(tableData.stats || {}) !== JSON.stringify(stats) ||
      Number(tableData.scheduleRevision || 0) !== CALENDAR_REVISION
    ) {
      batch.set(tableRef, { stats, scheduleRevision: CALENDAR_REVISION, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      batchCount++;
    }

    // Every group owns exactly 8 registration slots. Existing occupied slots
    // are preserved; only missing slot documents are created here.
    for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
      const slotId = `S${seasonNumber}_L${LEAGUE_ID}_D${tier}_G${group}_R${rank}`;
      const slotRef = db.collection('league_slots_v1').doc(slotId);
      const slotSnap = await slotRef.get();
      const placedTeam = Array.isArray(seededTeams) ? seededTeams[rank - 1] : null;
      const placedId = String(placedTeam?.id || '');
      const isHumanClub = Boolean(placedId && !placedId.startsWith('BOT_'));
      if (!slotSnap.exists || rolloverPlan) {
        batch.set(slotRef, {
          season: seasonNumber, leagueId: LEAGUE_ID, division: tier, group, rank,
          status: isHumanClub ? 'OCCUPIED' : 'FREE',
          occupantId: isHumanClub ? placedId : null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        batchCount++;
      }
      if (isHumanClub && rolloverPlan) {
        batch.set(db.collection('players_v14').doc(placedId), {
          selectedLeagueId: LEAGUE_ID, leagueLevel: tier, groupId: group, rank,
          lastProcessedSeason: seasonNumber, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        batchCount++;
      }
      if (batchCount >= BATCH_LIMIT) await commitBatch();
    }

    const calendar = generateSeasonCalendar(
      teams,
      seasonNumber,
      LEAGUE_ID,
      seasonStart,
    );

    const botBatchState = {
      count: batchCount,
      set: (ref: any, data: any) => { batch.set(ref, data, { merge: true }); batchCount++; botBatchState.count = batchCount; },
      commit: async () => { await commitBatch(); botBatchState.count = 0; },
    };
    await ensureBotClubs(db, teams, botBatchState);
    batchCount = botBatchState.count;

    // Only create missing matches. Existing scheduled/finished matches are immutable.
    const existingMatches = await db.collection('matches_v2')
      .where('season', '==', seasonNumber)
      .where('leagueId', '==', LEAGUE_ID)
      .where('level', '==', tier)
      .where('groupId', '==', group)
      .where('version', '==', 140)
      .get();
    const existingById = new Map<string, Record<string, any>>(existingMatches.docs.map((doc: any) => [doc.id, doc.data() as Record<string, any>]));

    for (const match of calendar) {
      const matchId = `match_v140_S${seasonNumber}_L${LEAGUE_ID}_V${tier}_G${group}_T${match.tour}_R${match.homeRank}_vs_R${match.awayRank}`;
      const ref = db.collection('matches_v2').doc(matchId);
      const existing = existingById.get(matchId);

      const payload = {
        ...match,
        id: matchId,
        leagueId: LEAGUE_ID,
        level: tier,
        groupId: group,
        season: seasonNumber,
        version: 140,
        calendarRevision: CALENDAR_REVISION,
      };

      if (!existing) {
        batch.set(ref, payload, { merge: true });
        if (existing) repairedMatches++;
        else createdMatches++;
        batchCount++;
      } else if (rolloverPlan && existing.isFinished !== true) {
        batch.set(ref, payload, { merge: true });
        repairedMatches++;
        batchCount++;
      } else if (Number(existing.groupId) !== group || Number(existing.level) !== tier) {
        batch.set(ref, { groupId: group, level: tier, calendarRevision: CALENDAR_REVISION }, { merge: true });
        repairedMatches++;
        batchCount++;
      }

      if (batchCount >= BATCH_LIMIT) await commitBatch();
    }

    if (batchCount >= BATCH_LIMIT) await commitBatch();
  }

  await commitBatch();

  // Final canonical readiness check: registration must never open against a
  // partial calendar. We intentionally do not repair or overwrite existing
  // matches here; this check only decides whether worldReady may be true.
  const readiness = await inspectCanonicalSeason(db, seasonNumber);
  const canonicalReady = readiness.ready;
  const buildingNextSeason = seasonNumber > activeSeasonBefore;
  if (!canonicalReady) {
    await lease.commit([{ ref: configRef, data: buildingNextSeason
      ? { preparedWorldReady: false, preparedPublished: false, phase: 'WORLD_BUILDING', updatedAt: FieldValue.serverTimestamp() }
      : { worldReady: false, phase: 'WORLD_BUILDING', updatedAt: FieldValue.serverTimestamp() }, options: { merge: true } }]);
    return { success: true, seasonNumber, seasonStart: seasonStart.toISOString(), nextSeasonStart: nextSeasonStart.toISOString(), createdMatches, repairedMatches, repairedSourceTables, totalExpectedMatches: TOTAL_GROUPS * 56, observedCanonicalMatches: readiness.observedCanonicalMatches,
      totalExpectedSlots: TOTAL_GROUPS * TEAMS_PER_GROUP, observedCanonicalSlots: readiness.observedCanonicalSlots,
      observedCanonicalTables: readiness.observedCanonicalTables, worldReady: false, prepared: false };
  }

  // A next-season build is neither publication nor activation. The active
  // season remains available; publication marks the prepared world separately,
  // and activation switches the active-season fields at the scheduled boundary.
  if (buildingNextSeason) {
    await lease.commit([{ ref: configRef, data: {
      preparedSeasonNumber: seasonNumber,
      preparedSeasonStart: seasonStart.toISOString(),
      preparedNextSeasonStart: nextSeasonStart.toISOString(),
      preparedCalendarRevision: CALENDAR_REVISION,
      preparedWorldReady: true,
      phase: current.preparedPublished === true && Number(current.preparedSeasonNumber) === seasonNumber ? 'PUBLISHED' : 'GENERATING_NEXT',
      updatedAt: FieldValue.serverTimestamp(),
    }, options: { merge: true } }]);
  } else {
    await lease.commit([{ ref: configRef, data: {
      activeSeasonNumber: seasonNumber,
      phase: current.phase === 'ACTIVE' ? 'ACTIVE' : 'REGULAR_SEASON',
      worldReady: true,
      seasonStart: seasonStart.toISOString(),
      nextSeasonStart: nextSeasonStart.toISOString(),
      calendarRevision: CALENDAR_REVISION,
      rebuildStatus: 'STAGE_3A8_COMPLETE',
      rebuildError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, options: { merge: true } }]);
  }

  return {
    success: true,
    seasonNumber,
    seasonStart: seasonStart.toISOString(),
    nextSeasonStart: nextSeasonStart.toISOString(),
    createdMatches,
    repairedMatches,
    repairedSourceTables,
    totalExpectedMatches: TOTAL_GROUPS * (TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1)),
    totalExpectedSlots: TOTAL_GROUPS * TEAMS_PER_GROUP,
    worldReady: buildingNextSeason ? current.worldReady === true : true,
    prepared: buildingNextSeason,
  };
}

/** Read-only canonical gate shared by build and the final publication step. */
async function inspectCanonicalSeason(db: any, seasonNumber: number) {
  const [allFinalMatches, allFinalSlots, allFinalTables] = await Promise.all([
    db.collection('matches_v2').where('season', '==', seasonNumber).where('leagueId', '==', LEAGUE_ID).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', seasonNumber).where('leagueId', '==', LEAGUE_ID).get(),
    db.collection('league_tables_v2').where('season', '==', seasonNumber).where('leagueId', '==', LEAGUE_ID).where('version', '==', 140).get(),
  ]);

  return evaluateCanonicalDocuments({
    tables: allFinalTables.docs,
    slots: allFinalSlots.docs,
    matches: allFinalMatches.docs,
  });
}

/**
 * Publish a fully validated next-season calendar without activating it.
 * Publication must complete by 16:00 MSK on the offseason day; activation is
 * a separate transaction at the configured next-season boundary (18:00 MSK).
 */
export async function publishPreparedSeason() {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const initialSnap = await configRef.get();
  if (!initialSnap.exists) return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_CONFIG_MISSING' };
  const initial = initialSnap.data() || {};
  const sourceSeason = Number(initial.activeSeasonNumber || 1);
  const targetSeason = Number(initial.nextSeasonNumber || initial.preparationTargetSeason || 0);
  if (!Number.isSafeInteger(targetSeason) || targetSeason !== sourceSeason + 1) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'INVALID_PUBLICATION_TARGET', sourceSeason, targetSeason };
  }
  if (initial.preparedPublished === true && Number(initial.preparedSeasonNumber) === targetSeason) {
    const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
    const [planSnap, readiness] = await Promise.all([
      planRef.get(),
      inspectCanonicalSeason(db, targetSeason),
    ]);
    const plan = planSnap.exists ? planSnap.data() || {} : null;
    const preparedStartMs = new Date(initial.preparedSeasonStart || '').getTime();
    const preparedNextStartMs = new Date(initial.preparedNextSeasonStart || '').getTime();
    const validPublishedState = initial.worldReady === true &&
      initial.preparedWorldReady === true &&
      String(initial.phase || '') === 'PUBLISHED' &&
      preparedStartMs === new Date(initial.nextSeasonStart || '').getTime() &&
      preparedNextStartMs === preparedStartMs + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000 &&
      validateRolloverPlan(plan, sourceSeason, targetSeason).valid &&
      readiness.ready;
    if (!validPublishedState) {
      return {
        success: false,
        action: 'WORLD_BUILDING',
        reason: 'PUBLISHED_SEASON_INTEGRITY_FAILED',
        sourceSeason,
        targetSeason,
        writesStarted: false,
        ...readiness,
      };
    }
    return {
      success: true,
      action: 'SEASON_ALREADY_PUBLISHED',
      sourceSeason,
      targetSeason,
      worldReady: true,
      preparedWorldReady: true,
      published: true,
      activated: false,
      ...readiness,
    };
  }
  if (initial.worldReady !== true || initial.preparedWorldReady !== true ||
      Number(initial.preparedSeasonNumber) !== targetSeason ||
      !initial.preparedSeasonStart || !initial.preparedNextSeasonStart ||
      !['GENERATING_NEXT', 'WORLD_BUILDING'].includes(String(initial.phase || ''))) {
    return { success: false, action: 'WORLD_BUILDING', reason: 'PREPARED_WORLD_NOT_READY', sourceSeason, targetSeason, writesStarted: false };
  }

  let lifecycle: ReturnType<typeof resolveSeasonLifecycleWindow>;
  try {
    lifecycle = resolveSeasonLifecycleWindow({
      seasonStart: initial.seasonStart,
      nextSeasonStart: initial.nextSeasonStart,
      now: new Date(),
    });
  } catch {
    return { success: false, action: 'WORLD_BUILDING', reason: 'SEASON_LIFECYCLE_WINDOW_INVALID', sourceSeason, targetSeason, writesStarted: false };
  }
  const preparedNextStartMs = new Date(initial.preparedNextSeasonStart).getTime();
  const expectedPreparedNextStartMs = lifecycle.activationAt.getTime() + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000;
  if (new Date(initial.preparedSeasonStart).getTime() !== lifecycle.activationAt.getTime()) {
    return { success: false, action: 'WORLD_BUILDING', reason: 'PREPARED_ACTIVATION_DATE_MISMATCH', sourceSeason, targetSeason, writesStarted: false };
  }
  if (!Number.isFinite(preparedNextStartMs) || preparedNextStartMs !== expectedPreparedNextStartMs) {
    return { success: false, action: 'WORLD_BUILDING', reason: 'PREPARED_NEXT_BOUNDARY_MISMATCH', sourceSeason, targetSeason, writesStarted: false };
  }
  if (lifecycle.publicationDeadlinePassed || lifecycle.activationDue) {
    return {
      success: false,
      action: 'WORLD_BUILDING',
      reason: lifecycle.activationDue ? 'PUBLICATION_WINDOW_CLOSED' : 'PUBLICATION_DEADLINE_MISSED',
      sourceSeason,
      targetSeason,
      publicationDeadline: lifecycle.publicationDeadlineAt.toISOString(),
      activationAt: lifecycle.activationAt.toISOString(),
      writesStarted: false,
    };
  }

  const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const planSnap = await planRef.get();
  const plan = planSnap.exists ? planSnap.data() || {} : null;
  if (!plan || !validateRolloverPlan(plan, sourceSeason, targetSeason).valid) {
    return { success: false, action: 'ROLLOVER_NOT_READY', sourceSeason, targetSeason, reason: 'ARCHIVE_OR_PLACEMENT_PLAN_NOT_READY' };
  }

  const readiness = await inspectCanonicalSeason(db, targetSeason);
  if (!readiness.ready) {
    return { success: false, action: 'WORLD_BUILDING', sourceSeason, targetSeason, reason: 'CANONICAL_CALENDAR_INCOMPLETE', ...readiness };
  }

  const lock = await acquireSeasonCalendarBuildLock(db, sourceSeason, targetSeason);
  if (!lock.acquired) {
    return { success: false, action: 'WORLD_BUILDING', worldReady: true, sourceSeason, targetSeason, reason: 'SEASON_CALENDAR_BUILD_LOCKED', lockExpiresAtMs: lock.expiresAtMs };
  }
  try {
    try {
      await commitSeasonCalendarPublication(
        db,
        lock.ownerId,
        lock.token,
        {
          sourceSeason,
          targetSeason,
          calendarRevision: Number(initial.preparedCalendarRevision || 0),
          phase: String(initial.phase || ''),
          planRef,
          validatePlan: (candidate: any) => validateRolloverPlan(candidate, sourceSeason, targetSeason).valid,
          publicationDeadlineMs: lifecycle.publicationDeadlineAt.getTime(),
          activationAtMs: lifecycle.activationAt.getTime(),
        },
        {
          ref: configRef,
          data: {
            preparedPublished: true,
            preparedPublishedAt: FieldValue.serverTimestamp(),
            phase: 'PUBLISHED',
            updatedAt: FieldValue.serverTimestamp(),
          },
          options: { merge: true },
        },
      );
    } catch (error: any) {
      if (String(error?.message || '').includes('PUBLICATION_WINDOW_CLOSED')) {
        return { success: false, action: 'WORLD_BUILDING', reason: 'PUBLICATION_WINDOW_CLOSED', sourceSeason, targetSeason, writesStarted: false };
      }
      throw error;
    }
    return {
      success: true,
      action: 'SEASON_PUBLISHED',
      sourceSeason,
      targetSeason,
      worldReady: true,
      preparedWorldReady: true,
      published: true,
      activated: false,
      publicationDeadline: lifecycle.publicationDeadlineAt.toISOString(),
      activationAt: lifecycle.activationAt.toISOString(),
      ...readiness,
    };
  } finally {
    await releaseSeasonCalendarBuildLock(db, lock.ownerId, lock.token);
  }
}

/**
 * Atomically activate a previously published season at/after its scheduled
 * 18:00 MSK boundary. This never builds or publishes a world.
 */
export async function activatePublishedSeason() {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const initialSnap = await configRef.get();
  if (!initialSnap.exists) return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_CONFIG_MISSING' };
  const initial = initialSnap.data() || {};
  const sourceSeason = Number(initial.activeSeasonNumber || 1);
  const targetSeason = Number(initial.preparedSeasonNumber || initial.nextSeasonNumber || 0);
  if (!Number.isSafeInteger(targetSeason) || targetSeason !== sourceSeason + 1) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'INVALID_ACTIVATION_TARGET', sourceSeason, targetSeason };
  }
  if (initial.preparedPublished !== true || initial.preparedWorldReady !== true ||
      Number(initial.preparedSeasonNumber) !== targetSeason || initial.worldReady !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_NOT_PUBLISHED', sourceSeason, targetSeason, writesStarted: false };
  }

  const activationAtMs = new Date(initial.preparedSeasonStart || '').getTime();
  const preparedNextStartMs = new Date(initial.preparedNextSeasonStart || '').getTime();
  const expectedNextStartMs = activationAtMs + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(activationAtMs) || !Number.isFinite(preparedNextStartMs) || preparedNextStartMs !== expectedNextStartMs) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'PREPARED_SEASON_DATES_INVALID', sourceSeason, targetSeason, writesStarted: false };
  }
  const activationWindow = resolveSeasonActivationWindow({
    activationAt: new Date(activationAtMs),
    nextSeasonStart: new Date(preparedNextStartMs),
    now: new Date(),
  });
  if (!activationWindow.ready) {
    return {
      success: false,
      action: 'WORLD_NOT_READY',
      reason: activationWindow.reason,
      sourceSeason,
      targetSeason,
      activationAt: activationWindow.activationAt.toISOString(),
      nextSeasonStart: activationWindow.nextSeasonStart.toISOString(),
      writesStarted: false,
    };
  }

  const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const readiness = await inspectCanonicalSeason(db, targetSeason);
  if (!readiness.ready) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'CANONICAL_CALENDAR_INCOMPLETE', sourceSeason, targetSeason, ...readiness };
  }

  const result = await db.runTransaction(async (tx: any) => {
    const [configSnap, planSnap] = await Promise.all([tx.get(configRef), tx.get(planRef)]);
    if (!configSnap.exists) return { success: false, reason: 'SEASON_CONFIG_MISSING' };
    const current = configSnap.data() || {};
    const plan = planSnap.exists ? planSnap.data() || {} : null;
    if (Number(current.activeSeasonNumber || 1) !== sourceSeason ||
        Number(current.preparedSeasonNumber || 0) !== targetSeason ||
        Number(current.nextSeasonNumber || 0) !== targetSeason ||
        Number(current.preparationTargetSeason || 0) !== targetSeason ||
        current.worldReady !== true || current.preparedWorldReady !== true ||
        current.preparedPublished !== true ||
        String(current.phase || '') !== 'PUBLISHED' ||
        Number(current.preparedCalendarRevision || 0) !== CALENDAR_REVISION ||
        new Date(current.preparedSeasonStart || '').getTime() !== activationAtMs ||
        new Date(current.preparedNextSeasonStart || '').getTime() !== preparedNextStartMs ||
        new Date(current.nextSeasonStart || '').getTime() !== activationAtMs) {
      return { success: false, reason: 'ACTIVATION_STATE_CHANGED' };
    }
    const transactionNowMs = Date.now();
    if (transactionNowMs < activationAtMs) return { success: false, reason: 'ACTIVATION_NOT_DUE' };
    if (transactionNowMs >= preparedNextStartMs) return { success: false, reason: 'ACTIVATION_WINDOW_EXPIRED' };
    if (!validateRolloverPlan(plan, sourceSeason, targetSeason).valid) {
      return { success: false, reason: 'ROLLOVER_PLAN_INVALID' };
    }
    tx.update(configRef, {
      activeSeasonNumber: targetSeason,
      phase: 'REGULAR_SEASON',
      worldReady: true,
      seasonStart: current.preparedSeasonStart,
      nextSeasonStart: current.preparedNextSeasonStart,
      calendarRevision: Number(current.preparedCalendarRevision || CALENDAR_REVISION),
      nextSeasonNumber: FieldValue.delete(),
      preparationTargetSeason: FieldValue.delete(),
      preparedSeasonNumber: FieldValue.delete(),
      preparedSeasonStart: FieldValue.delete(),
      preparedNextSeasonStart: FieldValue.delete(),
      preparedCalendarRevision: FieldValue.delete(),
      preparedWorldReady: FieldValue.delete(),
      preparedPublished: FieldValue.delete(),
      preparedPublishedAt: FieldValue.delete(),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true };
  });

  if (result.success !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: result.reason || 'ACTIVATION_BLOCKED', sourceSeason, targetSeason, writesStarted: false };
  }
  return { success: true, action: 'SEASON_ACTIVATED', sourceSeason, targetSeason, worldReady: true, activationAt: new Date(activationAtMs).toISOString(), ...readiness };
}

/**
 * Serialize all calendar builders, including callers that reuse an existing
 * rollover plan. The lease is fenced by owner and token before every batch or
 * publication write, so an expired process cannot publish a new world.
 */
export async function ensureSeasonCalendar(requestedTargetSeason?: number) {
  const db = getAdminDb();
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  const config = configSnap.exists ? configSnap.data() || {} : {};
  const sourceSeason = Number(config.activeSeasonNumber || 1);
  const phase = String(config.phase || '').toUpperCase();
  const configuredNextCandidates = [config.nextSeasonNumber, config.preparationTargetSeason]
    .map((value: any) => Number(value))
    .filter((value: number) => Number.isSafeInteger(value) && value > sourceSeason && value <= sourceSeason + 1);
  const configuredNextTarget = configuredNextCandidates.length ? Math.max(...configuredNextCandidates) : 0;
  const nextStartMs = config.nextSeasonStart ? new Date(config.nextSeasonStart).getTime() : NaN;
  const scheduledBoundaryPassed = Number.isFinite(nextStartMs) && Date.now() >= nextStartMs;
  const phaseRequestsPreparation = ['FINALIZING', 'GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED'].includes(phase);
  const inferredTarget = configuredNextTarget || (phaseRequestsPreparation || scheduledBoundaryPassed ? sourceSeason + 1 : sourceSeason);
  const requestedTarget = Number(requestedTargetSeason || 0);
  let targetSeason = requestedTarget > sourceSeason ? requestedTarget : inferredTarget;
  // A truly empty database is allowed to bootstrap its first canonical world.
  // Do not treat a missing config in a populated database as permission to
  // overwrite/repair it: only bypass the source-season preflight when all four
  // canonical collections are empty. This is a read-only check.
  let pristineFirstWorld = false;
  if (!configSnap.exists) {
    const [tables, slots, matches, players] = await Promise.all([
      db.collection('league_tables_v2').limit(1).get(),
      db.collection('league_slots_v1').limit(1).get(),
      db.collection('matches_v2').limit(1).get(),
      db.collection('players_v14').limit(1).get(),
    ]);
    pristineFirstWorld = [tables, slots, matches, players].every((snapshot: any) => snapshot.empty === true || snapshot.size === 0);
    if (!pristineFirstWorld) {
      return {
        success: false,
        worldReady: false,
        action: 'WORLD_BUILDING',
        reason: 'SEASON_CONFIG_MISSING_IN_NONEMPTY_DATABASE',
        writesStarted: false,
      };
    }
  }

  // A delayed cron may find more than one elapsed boundary. Never provision
  // the first missed season and publish it retroactively. Every elapsed
  // intermediate season must already have a verified immutable archive before
  // a direct catch-up can be considered. The current calendar builder only
  // publishes one adjacent season, so a multi-season gap remains read-only.
  if (!pristineFirstWorld && configSnap.exists) {
    const hardcodedSeasonStart = sourceSeason === 1
      ? new Date(FIRST_SEASON_START_ISO)
      : addDays(new Date(FIRST_SEASON_NEXT_START_ISO), (sourceSeason - 2) * TOTAL_CYCLE_DAYS);
    const hardcodedBoundary = sourceSeason === 1
      ? new Date(FIRST_SEASON_NEXT_START_ISO)
      : addDays(hardcodedSeasonStart, TOTAL_CYCLE_DAYS);
    const transitionPhases = ['FINALIZING', 'GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'WORLD_BUILDING'];
    const transitioning = transitionPhases.includes(String(config.phase || '').toUpperCase());
    const persistedStart = config.seasonStart ? new Date(config.seasonStart) : null;
    const persistedNext = config.nextSeasonStart ? new Date(config.nextSeasonStart) : null;
    const resolvedWindow = resolveCanonicalSeasonDateWindow({
      worldGeneration: config.worldGeneration,
      activeSeasonNumber: sourceSeason,
      persistedSeasonStart: persistedStart,
      persistedNextSeasonStart: persistedNext,
      canonicalSeasonStart: hardcodedSeasonStart,
      canonicalNextSeasonStart: hardcodedBoundary,
    });
    const canonicalSeasonStart = resolvedWindow.seasonStart;
    const canonicalBoundary = resolvedWindow.nextSeasonStart;
    if (!transitioning && resolvedWindow.source === 'CANONICAL' &&
        ((persistedStart && persistedStart.getTime() !== canonicalSeasonStart.getTime()) ||
         (persistedNext && persistedNext.getTime() !== canonicalBoundary.getTime()))) {
      return { success: false, worldReady: false, action: 'WORLD_BUILDING', reason: 'SEASON_DATE_CONFIG_MISMATCH', writesStarted: false };
    }
    let datePlan;
    try {
      datePlan = deriveSeasonDatePlan(sourceSeason, canonicalSeasonStart, canonicalBoundary, new Date(), TOTAL_CYCLE_DAYS);
    } catch {
      return { success: false, worldReady: false, action: 'WORLD_BUILDING', reason: 'SEASON_DATE_CONFIG_INVALID', writesStarted: false };
    }

    const explicitRecoveryTarget = Number(config.recoveryTargetSeason || 0);
    const directRecoveryTarget = explicitRecoveryTarget === datePlan.expectedSeasonNumber && requestedTarget === explicitRecoveryTarget;
    if (datePlan.expectedSeasonNumber > sourceSeason + 1) {
      const archiveStates: Record<number, { valid: boolean; reason?: string }> = {};
      for (const missedSeason of datePlan.completedSeasons.filter(season => season > sourceSeason)) {
        const archiveRef = db.collection('league_season_archives_v1').doc(`S${missedSeason}`);
        const archiveSnap = await archiveRef.get();
        if (!archiveSnap.exists) {
          archiveStates[missedSeason] = { valid: false, reason: 'ARCHIVE_MISSING' };
          continue;
        }
        const archiveData = archiveSnap.data() || {};
        if (!isCompletedSeasonArchive(archiveData) && !(missedSeason === 2 && isRecoveredSeasonArchive(archiveData))) {
          archiveStates[missedSeason] = { valid: false, reason: 'ARCHIVE_INVALID' };
          continue;
        }
        const archivedMatchesSnap = await archiveRef.collection('matches').get();
        const archivedMatches = archivedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
        const validation = isRecoveredSeasonArchive(archiveData)
          ? { valid: true, reasons: [] as string[] }
          : validateSeasonArchiveSnapshot(archiveData, archivedMatches);
        archiveStates[missedSeason] = validation.valid ? { valid: true } : { valid: false, reason: 'ARCHIVE_INVALID' };
      }
    const archiveGate = evaluateExpiredSeasonArchives(datePlan, archiveStates);
      if (!archiveGate.ready) {
        return {
          success: false, worldReady: false, action: 'WORLD_BUILDING',
          reason: archiveGate.reason,
          expectedSeasonNumber: datePlan.expectedSeasonNumber,
          expectedSeasonStart: datePlan.expectedSeasonStart.toISOString(),
          missedSeasons: archiveGate.missedSeasons,
          invalidSeasons: archiveGate.invalidSeasons,
          writesStarted: false,
        };
      }
      if (directRecoveryTarget && archiveGate.ready) targetSeason = explicitRecoveryTarget;
      else if (!canPrepareImmediateCatchUpTarget(sourceSeason, targetSeason, archiveGate.ready)) return {
        success: false, worldReady: false, action: 'WORLD_BUILDING',
        reason: 'SEQUENTIAL_SEASON_CATCH_UP_REQUIRED',
        expectedSeasonNumber: datePlan.expectedSeasonNumber,
        expectedSeasonStart: datePlan.expectedSeasonStart.toISOString(),
        missedSeasons: archiveGate.missedSeasons,
        writesStarted: false,
      };
    }
  }

  const directRecoveryBuild = targetSeason === Number(config.recoveryTargetSeason || 0) && targetSeason > sourceSeason + 1;
  const beforeLockPreflight = pristineFirstWorld || directRecoveryBuild
    ? { ready: true, diagnostics: [] as any[] }
    : await inspectCalendarRepairPreflight(db, sourceSeason);
  if (!beforeLockPreflight.ready) {
    return { success: false, worldReady: false, action: 'WORLD_BUILDING', reason: 'SEASON_CALENDAR_PREFLIGHT_FAILED', diagnostics: beforeLockPreflight.diagnostics, writesStarted: false };
  }
  const lock = await acquireSeasonCalendarBuildLock(db, sourceSeason, targetSeason);
  if (!lock.acquired) {
    return {
      success: false,
      worldReady: false,
      seasonNumber: sourceSeason,
      targetSeasonNumber: targetSeason,
      action: 'WORLD_BUILDING',
      reason: 'SEASON_CALENDAR_BUILD_LOCKED',
      lockExpiresAtMs: lock.expiresAtMs,
    };
  }
  const lease: BuildLease = {
    assert: async () => { await assertSeasonCalendarBuildLock(db, lock.ownerId, lock.token); },
    commit: writes => commitSeasonCalendarWrites(db, lock.ownerId, lock.token, writes),
  };
  try {
    const lockedPreflight = pristineFirstWorld || directRecoveryBuild
      ? { ready: true, diagnostics: [] as any[] }
      : await inspectCalendarRepairPreflight(db, sourceSeason);
    if (!lockedPreflight.ready) {
      return { success: false, worldReady: false, action: 'WORLD_BUILDING', reason: 'SEASON_CALENDAR_PREFLIGHT_FAILED', diagnostics: lockedPreflight.diagnostics, writesStarted: false };
    }

    // A published calendar is immutable. Repeated cron runs may verify it,
    // but must never repair or rewrite its fixtures after publication.
    const latestConfigSnap = await db.collection('system_v1').doc('season_config').get();
    const latestConfig = latestConfigSnap.exists ? latestConfigSnap.data() || {} : {};
    if (latestConfig.preparedPublished === true && Number(latestConfig.preparedSeasonNumber) === targetSeason) {
      const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
      const [planSnap, readiness] = await Promise.all([
        planRef.get(),
        inspectCanonicalSeason(db, targetSeason),
      ]);
      const planSource = directRecoveryBuild ? targetSeason - 1 : sourceSeason;
      const plan = planSnap.exists ? planSnap.data() || {} : null;
      const publishedReady = latestConfig.preparedWorldReady === true &&
        validateRolloverPlan(plan, planSource, targetSeason).valid &&
        readiness.ready;
      if (!publishedReady) {
        return {
          success: false,
          action: 'WORLD_BUILDING',
          worldReady: latestConfig.worldReady === true,
          seasonNumber: sourceSeason,
          targetSeasonNumber: targetSeason,
          reason: 'PUBLISHED_SEASON_INTEGRITY_FAILED',
          writesStarted: false,
          ...readiness,
        };
      }
      return {
        success: true,
        action: 'SEASON_ALREADY_PUBLISHED',
        seasonNumber: targetSeason,
        seasonStart: latestConfig.preparedSeasonStart,
        nextSeasonStart: latestConfig.preparedNextSeasonStart,
        worldReady: latestConfig.worldReady === true,
        prepared: true,
        published: true,
        createdMatches: 0,
        repairedMatches: 0,
        totalExpectedMatches: TOTAL_GROUPS * 56,
        totalExpectedSlots: TOTAL_GROUPS * TEAMS_PER_GROUP,
        ...readiness,
      };
    }

    if (targetSeason > sourceSeason) {
      await lease.commit([{ ref: db.collection('system_v1').doc('season_config'), data: {
        phase: config.preparedPublished === true && Number(config.preparedSeasonNumber) === targetSeason ? 'PUBLISHED' : 'GENERATING_NEXT',
        nextSeasonNumber: targetSeason,
        preparationTargetSeason: targetSeason,
        preparedSeasonNumber: targetSeason,
        preparedWorldReady: config.preparedWorldReady === true && Number(config.preparedSeasonNumber) === targetSeason,
        updatedAt: FieldValue.serverTimestamp(),
      }, options: { merge: true } }]);
    }
    return await buildSeasonCalendar(lease, pristineFirstWorld);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lock.ownerId, lock.token);
  }
}
