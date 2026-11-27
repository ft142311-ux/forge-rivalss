import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { commitSeasonActivation } from './season-activation-commit';
import { completeSeasonHistoryCleanup } from './season-history-cleanup';
import { pruneSeasonHistoryAfterActivation } from './season-history-prune';
import { prepareSeasonRollover } from './season-rollover';
import { generatePyramidCup, preparePyramidCupForSeason } from './cup-engine';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';
import { acquireSeasonCalendarBuildLock, assertSeasonCalendarBuildLock, commitSeasonCalendarPublication, commitSeasonCalendarWrites, releaseSeasonCalendarBuildLock } from './season-rollover-lock';
import { buildCarryForwardGroups, buildPromotionRelegationGroups, compareRecoveryRolloverPlans, resolveRecoveryPlacementSource, validateRolloverPlan } from './season-rollover-plan';
import { getRecoveryRolloverPlanSignature } from './season-rollover-plan-signature';
import { resolvePendingSkippedHistoryMarker, resolvePostActivationRetry, resolveSeasonCatchUpPolicy, type SeasonHistoryState } from './season-history-policy';
import { evaluateCanonicalDocuments } from './season-canonical';
import {
  isCanonicalCupParticipantField,
  isCanonicalPyramidCupOpeningField,
  isValidCupParticipantMatchSnapshot,
  isCupParticipantMatchSnapshotCompatible,
} from '@/app/lib/cup-participant-integrity';
import { resolvePreparedSlotRetry, shouldRepairExistingMatchCoordinates } from './season-calendar-retry-policy';
import { publishRecoveryRolloverDecision } from './season-recovery-publication';
import { inspectGroupReconciliation } from './season-rollover-standings';
import { getAdminDb } from '@/lib/firebase-admin';
import { advanceAtMostOneSeasonBoundary, deriveRecoverySeasonWindow, deriveSeasonDatePlan, resolveCanonicalSeasonDateWindow, resolveNextSeasonTarget, resolveSeasonActivationWindow, resolveSeasonLifecycleWindow } from './season-boundary';
import { FIRST_SEASON_NEXT_START_ISO } from '@/app/lib/time-utils';
import { isRolloverPlanPublicationReady } from './season-awards-policy';
import { buildRecoveredSeasonArchiveSnapshot, isCompletedSeasonArchive, isRecoveredSeasonArchive, isSeasonArchiveReadyToComplete, validateSeasonArchiveSnapshot } from './season-archive';
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

/**
 * A normal rollover plan is publishable only while it is still bound to the
 * completed source-season archive. Recovery carry-forward plans intentionally
 * represent skipped/incomplete seasons and therefore have no final standings
 * archive to compare against.
 */
async function inspectRolloverPlanSourceArchive(db: any, plan: any) {
  if (plan?.mode === 'recovery_carry_forward') {
    return { valid: true, recoveryCarryForward: true, archive: null, matches: [] as any[] };
  }
  const sourceSeason = Number(plan?.sourceSeason);
  if (!Number.isSafeInteger(sourceSeason) || sourceSeason < 1) {
    return { valid: false, reason: 'ROLLOVER_SOURCE_SEASON_INVALID', archive: null, matches: [] as any[] };
  }
  const archiveRef = db.collection('league_season_archives_v1').doc(`S${sourceSeason}`);
  const archiveSnap = await archiveRef.get();
  if (!archiveSnap.exists) {
    return { valid: false, reason: 'ROLLOVER_SOURCE_ARCHIVE_MISSING', archive: null, matches: [] as any[] };
  }
  const archive = archiveSnap.data() || {};
  const matchesSnap = await archiveRef.collection('matches').get();
  const matches = matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  if (!isCompletedSeasonArchive(archive) || !isSeasonArchiveReadyToComplete(archive, matches, plan)) {
    return { valid: false, reason: 'ROLLOVER_SOURCE_ARCHIVE_PLAN_MISMATCH', archive, matches };
  }
  return { valid: true, recoveryCarryForward: false, archive, matches };
}

function isPlanBoundToValidatedSourceArchive(validation: any, plan: any) {
  return validation?.valid === true && (
    validation.recoveryCarryForward === true ||
    isSeasonArchiveReadyToComplete(validation.archive, validation.matches, plan)
  );
}

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
  return { ready: validation.ready, observedCanonicalMatches: validation.observedCanonicalMatches, diagnostics: validation.reasons.map(reason => ({ reason })) };
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

type RecoveryPlanResult =
  | { ready: true; plan: Record<string, any>; skippedSeasons: Array<{ seasonNumber: number; reason: string }>; retainedArchiveSeason: number | null }
  | { ready: false; reason: string; details?: any };

/**
 * Inspect every elapsed season without simulating anything. Fully completed
 * seasons require a verified archive; genuinely incomplete seasons are marked
 * as skipped. The target plan is derived from the latest verified final table,
 * or from the active season's original slot placements when no completed
 * archive exists.
 */
async function prepareRecoveryCarryForwardPlan(
  db: any,
  activeSeason: number,
  targetSeason: number,
  lease: BuildLease,
): Promise<RecoveryPlanResult> {
  const states: Record<number, SeasonHistoryState> = {};
  let latestCompletedArchive: { season: number; standings: Record<string, any[]> } | null = null;
  let latestRecoveredParticipants: { season: number; groups: Record<string, any[]> } | null = null;
  let previousRetainedArchiveSeason: number | null = null;
  const invalidPreviousArchiveSeasons: number[] = [];

  if (activeSeason > 1) {
    const priorArchivesSnap = await db.collection('league_season_archives_v1').get();
    for (const archiveDoc of priorArchivesSnap.docs) {
      const match = /^S(\d+)$/.exec(archiveDoc.id);
      const seasonNumber = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1 || seasonNumber >= activeSeason) continue;
      const archive = archiveDoc.data() || {};
      if (isRecoveredSeasonArchive(archive)) continue;
      if (!isCompletedSeasonArchive(archive)) {
        invalidPreviousArchiveSeasons.push(seasonNumber);
        continue;
      }
      const matchesSnap = await archiveDoc.ref.collection('matches').get();
      const matches = matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
      const validation = validateSeasonArchiveSnapshot(archive, matches);
      if (!validation.valid) invalidPreviousArchiveSeasons.push(seasonNumber);
      else if (previousRetainedArchiveSeason === null || seasonNumber > previousRetainedArchiveSeason) {
        previousRetainedArchiveSeason = seasonNumber;
      }
    }
  }

  const inspectCanonicalResults = async (seasonNumber: number) => {
    const snap = await db.collection('matches_v2')
      .where('season', '==', seasonNumber)
      .where('version', '==', 140)
      .get();
    const isExcludedCompetition = (m: any) => {
      const type = String(m.matchType || m.type || m.competitionType || '').toLowerCase();
      return /(cup|tournament|friendly|scrim|pyramid)/.test(type) || m.isCup === true ||
        m.isFriendly === true || m.tournamentId || m.cupId ||
        (m.leagueId && String(m.leagueId) !== LEAGUE_ID);
    };
    const invalidLeagueCoordinates = snap.docs.some((doc: any) => {
      const m = doc.data() || {};
      if (isExcludedCompetition(m)) return false;
      const hasLeagueCoordinates = ['level', 'division', 'groupId', 'group', 'homeRank', 'awayRank']
        .some(field => m[field] !== undefined && m[field] !== null);
      const matchType = String(m.matchType || m.type || m.competitionType || '').toLowerCase();
      const explicitlyLeague = matchType === 'league' || String(m.leagueId || '') === LEAGUE_ID;
      if (!explicitlyLeague && !hasLeagueCoordinates) return false;
      const level = Number(m.level || m.division || 0);
      const group = Number(m.groupId || m.group || 0);
      const homeRank = Number(m.homeRank || 0);
      const awayRank = Number(m.awayRank || 0);
      return !(level >= 1 && level <= MAX_LEVELS && group >= 1 && group <= Math.pow(2, level - 1) &&
        homeRank >= 1 && homeRank <= TEAMS_PER_GROUP && awayRank >= 1 && awayRank <= TEAMS_PER_GROUP &&
        homeRank !== awayRank);
    });
    if (invalidLeagueCoordinates) {
      return { status: 'integrity_conflict' as const, reason: 'INVALID_CANONICAL_FIXTURE_COORDINATE' };
    }
    const canonical = snap.docs.filter((doc: any) => {
      const m = doc.data() || {};
      if (isExcludedCompetition(m)) return false;
      const level = Number(m.level || m.division || 0);
      const group = Number(m.groupId || m.group || 0);
      const homeRank = Number(m.homeRank || 0);
      const awayRank = Number(m.awayRank || 0);
      return level >= 1 && level <= MAX_LEVELS && group >= 1 && group <= Math.pow(2, level - 1) &&
        homeRank >= 1 && homeRank <= TEAMS_PER_GROUP && awayRank >= 1 && awayRank <= TEAMS_PER_GROUP &&
        homeRank !== awayRank;
    });
    const fixtures = new Set<string>();
    const groupCounts = new Map<string, number>();
    let unfinished = 0;
    let invalidFinished = 0;
    for (const doc of canonical) {
      const m = doc.data() || {};
      const level = Number(m.level || m.division);
      const group = Number(m.groupId || m.group);
      const key = `${level}:${group}:${Number(m.homeRank)}:${Number(m.awayRank)}`;
      const groupKey = `${level}:${group}`;
      groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
      if (fixtures.has(key)) return { status: 'integrity_conflict' as const, reason: 'DUPLICATE_CANONICAL_FIXTURE' };
      fixtures.add(key);
      if (m.isFinished !== true) {
        unfinished++;
        continue;
      }
      const home = Number(m.seriesScore?.home ?? m.scoreA);
      const away = Number(m.seriesScore?.away ?? m.scoreB);
      if (String(m.status || '').toLowerCase() !== 'finished' ||
          !Number.isInteger(home) || !Number.isInteger(away) ||
          home < 0 || away < 0 || home > 2 || away > 2 || (home === 0 && away === 0)) {
        invalidFinished++;
      }
    }
    if (canonical.length > TOTAL_GROUPS * 56 || invalidFinished > 0 || [...groupCounts.values()].some(count => count > 56)) {
      return { status: 'integrity_conflict' as const, reason: invalidFinished ? 'INVALID_FINISHED_RESULT' : 'TOO_MANY_CANONICAL_FIXTURES' };
    }
    const finishedMatches = canonical.length - unfinished;
    if (canonical.length === 0) return { status: 'no_canonical_results' as const, reason: 'NO_CANONICAL_RESULTS', finishedMatches: 0, canonicalMatches: 0 };
    if (canonical.length === TOTAL_GROUPS * 56 && unfinished === 0 && groupCounts.size === TOTAL_GROUPS && [...groupCounts.values()].every(count => count === 56)) {
      return { status: 'completed' as const, archiveValid: false, archiveReason: 'COMPLETED_ARCHIVE_REQUIRED', finishedMatches, canonicalMatches: canonical.length };
    }
    return { status: 'incomplete' as const, reason: 'SEASON_INCOMPLETE', finishedMatches, canonicalMatches: canonical.length };
  };

  const persistRecoveredArchive = async (seasonNumber: number, liveState: any) => {
    const slotsSnap = await db.collection('league_slots_v1')
      .where('season', '==', seasonNumber)
      .where('leagueId', '==', LEAGUE_ID)
      .get();
    const sourceGroups: Record<string, any[]> = {};
    for (const slotDoc of slotsSnap.docs) {
      const slot = slotDoc.data() || {};
      const level = Number(slot.division || slot.level || 0);
      const group = Number(slot.group || 0);
      const rank = Number(slot.rank || 0);
      if (level < 1 || level > MAX_LEVELS || group < 1 || group > Math.pow(2, level - 1) ||
          rank < 1 || rank > TEAMS_PER_GROUP) {
        return { ready: false, reason: 'RECOVERED_ARCHIVE_SLOT_COORDINATES_INVALID', slotId: slotDoc.id };
      }
      const key = `D${level}-G${group}`;
      const status = String(slot.status || '').toUpperCase();
      const occupantId = String(slot.occupantId || '');
      const id = status === 'FREE'
        ? getBotId(LEAGUE_ID, level, group, rank)
        : status === 'OCCUPIED' ? occupantId : '';
      if (!id || (status !== 'FREE' && status !== 'OCCUPIED')) {
        return { ready: false, reason: 'RECOVERED_ARCHIVE_SLOT_IDENTITY_UNTRUSTED', slotId: slotDoc.id, status };
      }
      if (!sourceGroups[key]) sourceGroups[key] = [];
      sourceGroups[key].push({ id, name: status === 'FREE' ? getBotName(level, group, rank) : String(slot.occupantName || id), rank });
    }
    const snapshot = buildRecoveredSeasonArchiveSnapshot({
      sourceSeason: seasonNumber,
      startingParticipants: sourceGroups,
      finishedMatches: Number(liveState.finishedMatches || 0),
      reason: String(liveState.reason || 'SEASON_INCOMPLETE'),
    });
    if (!snapshot.ready) return snapshot;
    const archiveRef = db.collection('league_season_archives_v1').doc(`S${seasonNumber}`);
    await lease.commit([{ ref: archiveRef, data: snapshot.archive }]);
    return { ready: true, archive: snapshot.archive };
  };

  for (let season = activeSeason; season < targetSeason; season++) {
    const archiveRef = db.collection('league_season_archives_v1').doc(`S${season}`);
    const archiveSnap = await archiveRef.get();
    if (archiveSnap.exists) {
      const archive = archiveSnap.data() || {};
      if (isCompletedSeasonArchive(archive)) {
        const matchesSnap = await archiveRef.collection('matches').get();
        const matches = matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
        const validation = validateSeasonArchiveSnapshot(archive, matches);
        if (!validation.valid) {
          states[season] = { status: 'integrity_conflict', reason: validation.reasons.join(',') || 'ARCHIVE_INVALID' };
          continue;
        }
        states[season] = { status: 'completed', archiveValid: true };
        if (!latestCompletedArchive || season > latestCompletedArchive.season) {
          latestCompletedArchive = { season, standings: archive.standings || {} };
        }
        continue;
      }
      if (isRecoveredSeasonArchive(archive)) {
        states[season] = { status: 'incomplete', reason: 'RECOVERED_INCOMPLETE_SEASON' };
        if (!latestRecoveredParticipants || season > latestRecoveredParticipants.season) {
          latestRecoveredParticipants = { season, groups: archive.startingParticipants || {} };
        }
        continue;
      }
      if (archive.status === 'preparing') {
        const resumed = await prepareSeasonRollover(db, season, season + 1);
        if (resumed.ready) {
          const resumedArchiveSnap = await archiveRef.get();
          const resumedArchive = resumedArchiveSnap.exists ? resumedArchiveSnap.data() || {} : null;
          const resumedMatchesSnap = resumedArchiveSnap.exists ? await archiveRef.collection('matches').get() : null;
          const resumedMatches = resumedMatchesSnap
            ? resumedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }))
            : [];
          const resumedValidation = resumedArchive
            ? validateSeasonArchiveSnapshot(resumedArchive, resumedMatches)
            : { valid: false, reasons: ['ARCHIVE_MISSING_AFTER_RESUME'] };
          if (!resumedArchive || !isCompletedSeasonArchive(resumedArchive) || !resumedValidation.valid) {
            return { ready: false, reason: 'PREPARING_SEASON_ARCHIVE_RESUME_VALIDATION_FAILED', details: { seasonNumber: season, reasons: resumedValidation.reasons } };
          }
          states[season] = { status: 'completed', archiveValid: true };
          if (!latestCompletedArchive || season > latestCompletedArchive.season) {
            latestCompletedArchive = { season, standings: resumedArchive.standings || {} };
          }
          continue;
        }
        const liveState = await inspectCanonicalResults(season);
        const canSkip = resumed.writesStarted !== true &&
          ['incomplete', 'no_canonical_results'].includes(String(liveState.status || ''));
        if (!canSkip) {
          return { ready: false, reason: 'PREPARING_SEASON_ARCHIVE_RECOVERY_FAILED', details: { seasonNumber: season, rollover: resumed, liveState } };
        }
        const recovered = await persistRecoveredArchive(season, liveState);
        const recoveredArchive = (recovered as any).archive;
        if (!recovered.ready || !recoveredArchive) {
          return { ready: false, reason: 'INCOMPLETE_SEASON_RECOVERY_SNAPSHOT_FAILED', details: { seasonNumber: season, recovery: recovered } };
        }
        states[season] = { status: 'incomplete', reason: liveState.reason || 'SEASON_INCOMPLETE' };
        latestRecoveredParticipants = { season, groups: recoveredArchive.startingParticipants };
        continue;
      }
      states[season] = { status: 'integrity_conflict', reason: 'EXISTING_ARCHIVE_NOT_VERIFIABLE' };
      continue;
    }
    const liveState = await inspectCanonicalResults(season);
    if (liveState.status === 'completed' && liveState.archiveValid === false) {
      // A genuinely completed season must be archived, not skipped. Reuse the
      // idempotent canonical rollover path to snapshot results and award prizes.
      const rollover = await prepareSeasonRollover(db, season, season + 1);
      if (!rollover.ready) {
        return { ready: false, reason: 'COMPLETED_SEASON_ARCHIVE_PREPARATION_FAILED', details: { seasonNumber: season, rollover } };
      }
      const completedArchiveSnap = await archiveRef.get();
      const completedArchive = completedArchiveSnap.exists ? completedArchiveSnap.data() || {} : null;
      const completedMatchesSnap = completedArchiveSnap.exists ? await archiveRef.collection('matches').get() : null;
      const completedMatches = completedMatchesSnap
        ? completedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }))
        : [];
      const completedValidation = completedArchive
        ? validateSeasonArchiveSnapshot(completedArchive, completedMatches)
        : { valid: false, reasons: ['ARCHIVE_MISSING_AFTER_PREPARATION'] };
      if (!completedArchive || !isCompletedSeasonArchive(completedArchive) || !completedValidation.valid) {
        return { ready: false, reason: 'COMPLETED_SEASON_ARCHIVE_VALIDATION_FAILED', details: { seasonNumber: season, reasons: completedValidation.reasons } };
      }
      states[season] = { status: 'completed', archiveValid: true };
      if (!latestCompletedArchive || season > latestCompletedArchive.season) {
        latestCompletedArchive = { season, standings: completedArchive.standings || {} };
      }
    } else if (liveState.status === 'incomplete' || liveState.status === 'no_canonical_results') {
      const recovered = await persistRecoveredArchive(season, liveState);
      const recoveredArchive = (recovered as any).archive;
      if (!recovered.ready || !recoveredArchive) {
        return { ready: false, reason: 'INCOMPLETE_SEASON_RECOVERY_SNAPSHOT_FAILED', details: { seasonNumber: season, recovery: recovered } };
      }
      states[season] = { status: 'incomplete', reason: liveState.reason || 'SEASON_INCOMPLETE' };
      if (!latestRecoveredParticipants || season > latestRecoveredParticipants.season) {
        latestRecoveredParticipants = { season, groups: recoveredArchive.startingParticipants };
      }
    } else {
      states[season] = liveState;
    }
  }

  const missed = Array.from({ length: Math.max(0, targetSeason - activeSeason) }, (_, index) => activeSeason + index);
  const policy = resolveSeasonCatchUpPolicy(missed, states);
  if (!policy.ready) {
    return { ready: false, reason: policy.reason || 'SEASON_HISTORY_REQUIRES_RECONCILIATION', details: { states, skippedSeasons: policy.skippedSeasons } };
  }
  const retainedArchiveSeason = Math.max(
    Number(policy.retainedArchiveSeason || 0),
    Number(previousRetainedArchiveSeason || 0),
  ) || null;
  if (invalidPreviousArchiveSeasons.length > 0) {
    return {
      ready: false,
      reason: 'PREVIOUS_RETAINED_ARCHIVE_REQUIRES_RECONCILIATION',
      details: { invalidPreviousArchiveSeasons, retainedArchiveSeason },
    };
  }

  let groups: Record<string, any[]>;
  let placementSource: string;
  let lastTrustedSeason: number;
  const placementBaseline = resolveRecoveryPlacementSource(
    latestCompletedArchive?.season ?? null,
    latestRecoveredParticipants?.season ?? null,
  );
  if (placementBaseline === 'recovered_participants' && latestRecoveredParticipants) {
    const carried = buildCarryForwardGroups(latestRecoveredParticipants.groups);
    if (!carried.ready) return { ready: false, reason: carried.reason, details: { group: carried.group } };
    groups = carried.groups;
    placementSource = 'recovered_starting_participants';
    lastTrustedSeason = latestRecoveredParticipants.season;
  } else if (placementBaseline === 'completed_archive' && latestCompletedArchive) {
    const promoted = buildPromotionRelegationGroups(latestCompletedArchive.standings);
    if (!promoted.ready) return { ready: false, reason: promoted.reason, details: { group: promoted.group, count: promoted.count } };
    groups = promoted.groups;
    placementSource = 'latest_verified_completed_archive';
    lastTrustedSeason = latestCompletedArchive.season;
  } else {
    const slotsSnap = await db.collection('league_slots_v1')
      .where('season', '==', activeSeason)
      .where('leagueId', '==', LEAGUE_ID)
      .get();
    const sourceGroups: Record<string, any[]> = {};
    for (const doc of slotsSnap.docs) {
      const slot = doc.data() || {};
      const level = Number(slot.division || slot.level || 0);
      const group = Number(slot.group || 0);
      const rank = Number(slot.rank || 0);
      if (level < 1 || level > MAX_LEVELS || group < 1 || group > Math.pow(2, level - 1) ||
          rank < 1 || rank > TEAMS_PER_GROUP) {
        return { ready: false, reason: 'ACTIVE_SEASON_SLOT_COORDINATES_INVALID', details: { slotId: doc.id } };
      }
      const key = `D${level}-G${group}`;
      const status = String(slot.status || '').toUpperCase();
      const occupantId = String(slot.occupantId || '');
      const id = status === 'FREE'
        ? getBotId(LEAGUE_ID, level, group, rank)
        : status === 'OCCUPIED' ? occupantId : '';
      if (!id || (status !== 'FREE' && status !== 'OCCUPIED')) {
        return { ready: false, reason: 'ACTIVE_SEASON_SLOT_IDENTITY_UNTRUSTED', details: { slotId: doc.id, status } };
      }
      if (!sourceGroups[key]) sourceGroups[key] = [];
      sourceGroups[key].push({ id, name: status === 'FREE' ? getBotName(level, group, rank) : String(slot.occupantName || id), rank });
    }
    const carried = buildCarryForwardGroups(sourceGroups);
    if (!carried.ready) return { ready: false, reason: carried.reason, details: { group: carried.group } };
    groups = carried.groups;
    placementSource = 'active_season_slot_baseline';
    lastTrustedSeason = activeSeason;
  }

  const plan = {
    sourceSeason: targetSeason - 1,
    targetSeason,
    leagueId: LEAGUE_ID,
    ready: true,
    mode: 'recovery_carry_forward',
    skippedSeasons: policy.skippedSeasons,
    lastTrustedSeason,
    placementSource,
    retainedArchiveSeason,
    promotionRule: placementBaseline === 'completed_archive' ? 'apply_latest_verified_completed_season_once' : 'carry_forward_without_promotion_or_relegation',
    groups,
    createdAt: FieldValue.serverTimestamp(),
  };
  const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const publication = await publishRecoveryRolloverDecision({
    planRef,
    plan,
    historyEntries: policy.skippedSeasons.map(skipped => ({
      seasonNumber: skipped.seasonNumber,
      reason: skipped.reason,
      ref: db.collection('league_season_history_v1').doc(`S${skipped.seasonNumber}`),
    })),
    targetSeason,
    batchLimit: BATCH_LIMIT,
    read: async ref => {
      const snapshot = await ref.get();
      return snapshot.exists ? snapshot.data() || {} : null;
    },
    commitPlan: async (ref, value) => {
      await lease.assert();
      await lease.commit([{ ref, data: value }]);
    },
    commitHistory: async writes => {
      await lease.commit(writes);
    },
    comparePlans: compareRecoveryRolloverPlans,
    resolvePendingMarker: resolvePendingSkippedHistoryMarker,
    buildPendingMarker: (entry, target) => ({
      seasonNumber: entry.seasonNumber,
      status: 'SKIPPED_PENDING_ACTIVATION',
      reason: entry.reason,
      targetSeason: target,
      noResultsFabricated: true,
      awardsApplied: false,
      promotionRelegationApplied: false,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  });
  if (!publication.ready) {
    return {
      ready: false,
      reason: publication.reason,
      details: publication.details || { targetSeason },
    };
  }

  return {
    ready: true,
    plan: publication.plan,
    skippedSeasons: policy.skippedSeasons,
    retainedArchiveSeason: policy.retainedArchiveSeason,
  };
}

async function buildSeasonCalendar(lease: BuildLease, pristineFirstWorld = false) {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await configRef.get();
  const current = configSnap.exists ? configSnap.data() || {} : {};

  // Strip stale rank-9/duplicate rows before rollover reads the official table.
  // This preserves scores and the existing eight canonical ranks.
  const sourceSeasonNumber = Number(current.activeSeasonNumber || 1);
  const requestedRecoveryTarget = Number(current.nextSeasonNumber || current.preparationTargetSeason || current.preparedSeasonNumber || 0);
  const stagingFreshSeasonOneReset =
    current.stagingFreshSeasonOneReset === true &&
    sourceSeasonNumber === 1 &&
    Number(current.activeSeasonNumber || 1) === 1 &&
    current.worldReady === false;
  const now = new Date();
  // A reset executor deliberately removes the old Season 1 fixtures before
  // rebuilding the calendar. Do not run the normal source-season repair gate
  // against that intentionally empty intermediate state.
  const skipSourceRepair = requestedRecoveryTarget <= sourceSeasonNumber ||
    stagingFreshSeasonOneReset;
  const sourceRepairPreflight = skipSourceRepair
    ? null
    : await inspectCalendarRepairPreflight(db, sourceSeasonNumber);
  const sourceFixturesIncomplete = Boolean(sourceRepairPreflight &&
    Number(sourceRepairPreflight.observedCanonicalMatches || 0) < TOTAL_GROUPS * 56);
  const repairedSourceTables = skipSourceRepair || sourceFixturesIncomplete
    ? 0
    : await repairCanonicalSeasonTables(db, sourceSeasonNumber, lease);
  let seasonNumber = Number(current.activeSeasonNumber || 1);

  // Resolve the source season with the same canonical-date policy used by the
  // read-only catch-up gate. A stale persisted boundary must not override the
  // canonical production timeline during recovery; CLEAN_S1_V1 may retain its
  // own validated 17-day first-season window.
  const canonicalSourceStart = sourceSeasonNumber === 1
    ? new Date(FIRST_SEASON_START_ISO)
    : addDays(new Date(FIRST_SEASON_NEXT_START_ISO), (sourceSeasonNumber - 2) * TOTAL_CYCLE_DAYS);
  const canonicalSourceNext = sourceSeasonNumber === 1
    ? new Date(FIRST_SEASON_NEXT_START_ISO)
    : addDays(canonicalSourceStart, TOTAL_CYCLE_DAYS);
  const resolvedSourceWindow = resolveCanonicalSeasonDateWindow({
    worldGeneration: current.worldGeneration,
    activeSeasonNumber: sourceSeasonNumber,
    persistedSeasonStart: current.seasonStart ? new Date(current.seasonStart) : null,
    persistedNextSeasonStart: current.nextSeasonStart ? new Date(current.nextSeasonStart) : null,
    canonicalSeasonStart: canonicalSourceStart,
    canonicalNextSeasonStart: canonicalSourceNext,
  });
  let seasonStart = pristineFirstWorld ? now : resolvedSourceWindow.seasonStart;
  let nextBoundary = pristineFirstWorld
    ? addDays(seasonStart, TOTAL_CYCLE_DAYS)
    : resolvedSourceWindow.nextSeasonStart;

  // Each scheduler invocation advances at most one boundary. Every season
  // must pass its own completed-source archive and rollover gates.
  if (!pristineFirstWorld) {
    const boundaryStep = advanceAtMostOneSeasonBoundary(seasonNumber, seasonStart, nextBoundary, now, TOTAL_CYCLE_DAYS);
    seasonNumber = boundaryStep.seasonNumber;
    seasonStart = boundaryStep.seasonStart;
    nextBoundary = boundaryStep.nextBoundary;
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

  // Never build a target world without a verified completed archive and
  // deterministic placement plan for its immediate predecessor.
  let rolloverPlan: any = null;
  const activeSeasonBefore = Number(current.activeSeasonNumber || 1);
  if (configSnap.exists && seasonChanged && seasonNumber > activeSeasonBefore) {
    const planSourceSeason = activeSeasonBefore;
    const planSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
    const savedPlan = planSnap.exists ? planSnap.data() || {} : null;
    if (savedPlan && savedPlan.mode !== 'recovery_carry_forward' &&
        validateRolloverPlan(savedPlan, planSourceSeason, seasonNumber).valid &&
        isRolloverPlanPublicationReady(savedPlan)) {
      rolloverPlan = savedPlan;
    } else {
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
      if (!rolloverPlan) {
        const preparedPlanSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
        const preparedPlan = preparedPlanSnap.exists ? preparedPlanSnap.data() || {} : null;
        if (!validateRolloverPlan(preparedPlan, activeSeasonBefore, seasonNumber).valid || !isRolloverPlanPublicationReady(preparedPlan)) {
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
    }
  } else if (configSnap.exists && current.worldReady !== true && seasonNumber > 1) {
    // Recover an interrupted build. The previous run may already have advanced
    // activeSeasonNumber before all tables/slots/matches were committed.
    const planSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
    const savedPlan = planSnap.exists ? planSnap.data() || {} : null;
    if (savedPlan?.mode !== 'recovery_carry_forward' &&
        validateRolloverPlan(savedPlan, seasonNumber - 1, seasonNumber).valid &&
        isRolloverPlanPublicationReady(savedPlan)) {
      rolloverPlan = savedPlan;
    }
  }

  // Preflight every existing target slot against the immutable rollover placement
  // before the first target-world write. A retry must never silently evict a
  // human club or replace a conflicting occupant from a partially built world.
  if (rolloverPlan) {
    for (let index = 1; index <= TOTAL_GROUPS; index++) {
      const { tier, group } = getGroupCoordinates(index);
      const seededTeams = rolloverPlan.groups?.[`D${tier}-G${group}`];
      if (!Array.isArray(seededTeams) || seededTeams.length !== TEAMS_PER_GROUP) {
        return { success: false, action: 'WORLD_BUILDING', worldReady: current.worldReady === true,
          seasonNumber: activeSeasonBefore, targetSeasonNumber: seasonNumber,
          reason: 'ROLLOVER_PLAN_GROUP_INVALID', writesStarted: false };
      }
      for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
        const plannedId = String(seededTeams[rank - 1]?.id || '');
        const slotId = `S${seasonNumber}_L${LEAGUE_ID}_D${tier}_G${group}_R${rank}`;
        const slotSnap = await db.collection('league_slots_v1').doc(slotId).get();
        const decision = resolvePreparedSlotRetry(slotSnap.exists ? slotSnap.data() || {} : null, plannedId);
        if (!decision.ready) {
          return { success: false, action: 'WORLD_BUILDING', worldReady: current.worldReady === true,
            seasonNumber: activeSeasonBefore, targetSeasonNumber: seasonNumber,
            reason: decision.reason, slotId, plannedTeamId: plannedId,
            existingOccupantId: String((slotSnap.data() || {}).occupantId || ''), writesStarted: false };
        }
      }
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
        preparedRecoveryMode: false,
        preparedRolloverPlanSignature: rolloverPlan?.mode === 'recovery_carry_forward'
          ? getRecoveryRolloverPlanSignature(rolloverPlan)
          : FieldValue.delete(),
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
      pyramidCupRequired: pristineFirstWorld ? true : current.pyramidCupRequired === true,
      pyramidCupReady: pristineFirstWorld ? false : current.pyramidCupReady === true,
      pyramidCupReadySeasonNumber: pristineFirstWorld ? 1 : Number(current.pyramidCupReadySeasonNumber || 0),
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
      const slotDecision = rolloverPlan
        ? resolvePreparedSlotRetry(slotSnap.exists ? slotSnap.data() || {} : null, placedId)
        : { ready: true, action: slotSnap.exists ? 'PRESERVE' : 'CREATE' };
      if (!slotDecision.ready) {
        throw new Error(`PREPARED_SLOT_IDENTITY_CONFLICT:${slotId}`);
      }
      if (slotDecision.action === 'CREATE' || slotDecision.action === 'PLACE_HUMAN') {
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
      } else if (shouldRepairExistingMatchCoordinates(existing, tier, group)) {
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
      preparedRecoveryMode: false,
        preparedRolloverPlanSignature: rolloverPlan?.mode === 'recovery_carry_forward'
          ? getRecoveryRolloverPlanSignature(rolloverPlan)
          : FieldValue.delete(),
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
  const recoveryMode = initial.preparedRecoveryMode === true;
  if (recoveryMode) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'SEQUENTIAL_RECOVERY_MODE_DISABLED', sourceSeason, targetSeason, writesStarted: false };
  }
  if (!Number.isSafeInteger(targetSeason) || targetSeason !== sourceSeason + 1) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'INVALID_PUBLICATION_TARGET', sourceSeason, targetSeason };
  }
  // Enforce the Cup prerequisite at the publication boundary itself, not
  // only in the scheduler. Direct callers and retries must not bypass it.
  const cupPreparation = await preparePyramidCupForSeason(targetSeason);
  if (cupPreparation.success !== true) {
    return { success: false, action: 'WORLD_BUILDING', reason: 'PYRAMID_CUP_PREPARATION_BLOCKED', cupPreparation, sourceSeason, targetSeason, writesStarted: false };
  }
  if (initial.preparedPublished === true && Number(initial.preparedSeasonNumber) === targetSeason) {
    const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
    const [planSnap, readiness] = await Promise.all([
      planRef.get(),
      inspectCanonicalSeason(db, targetSeason),
    ]);
    const plan = planSnap.exists ? planSnap.data() || {} : null;
    const sourceArchiveValidation = plan
      ? await inspectRolloverPlanSourceArchive(db, plan)
      : { valid: false, reason: 'ROLLOVER_PLAN_MISSING' };
    const preparedStartMs = new Date(initial.preparedSeasonStart || '').getTime();
    const preparedNextStartMs = new Date(initial.preparedNextSeasonStart || '').getTime();
    const validPublishedState = sourceArchiveValidation.valid &&
      initial.worldReady === true &&
      initial.preparedWorldReady === true &&
      String(initial.phase || '') === 'PUBLISHED' &&
      preparedStartMs === new Date(initial.nextSeasonStart || '').getTime() &&
      preparedNextStartMs === preparedStartMs + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000 &&
      plan?.mode !== 'recovery_carry_forward' &&
      validateRolloverPlan(plan, sourceSeason, targetSeason).valid &&
      isRolloverPlanPublicationReady(plan) &&
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

  const preparedStartMs = new Date(initial.preparedSeasonStart).getTime();
  const preparedNextStartMs = new Date(initial.preparedNextSeasonStart).getTime();
  let lifecycle: ReturnType<typeof resolveSeasonLifecycleWindow> | null = null;
  // A late worker may publish the immediate successor while its scheduled
  // interval is still open. Expired intermediate seasons are never skipped.
  const overdueSequentialPublication = Date.now() >= preparedStartMs;
  if (overdueSequentialPublication) {
    const nowMs = Date.now();
    if (!Number.isFinite(preparedStartMs) || !Number.isFinite(preparedNextStartMs) ||
        preparedNextStartMs !== preparedStartMs + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000 ||
        nowMs < preparedStartMs || nowMs >= preparedNextStartMs) {
      return { success: false, action: 'WORLD_BUILDING', reason: 'SEQUENTIAL_PUBLICATION_WINDOW_EXPIRED', sourceSeason, targetSeason, writesStarted: false };
    }
  } else {
    try {
      lifecycle = resolveSeasonLifecycleWindow({
        seasonStart: initial.seasonStart,
        nextSeasonStart: initial.nextSeasonStart,
        now: new Date(),
      });
    } catch {
      return { success: false, action: 'WORLD_BUILDING', reason: 'SEASON_LIFECYCLE_WINDOW_INVALID', sourceSeason, targetSeason, writesStarted: false };
    }
    const expectedPreparedNextStartMs = lifecycle.activationAt.getTime() + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000;
    if (preparedStartMs !== lifecycle.activationAt.getTime()) {
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
  }

  const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const planSnap = await planRef.get();
  const plan = planSnap.exists ? planSnap.data() || {} : null;
  const planSourceSeason = recoveryMode ? targetSeason - 1 : sourceSeason;
  if (!plan || !validateRolloverPlan(plan, planSourceSeason, targetSeason).valid || !isRolloverPlanPublicationReady(plan)) {
    return { success: false, action: 'ROLLOVER_NOT_READY', sourceSeason, targetSeason, reason: 'ARCHIVE_OR_PLACEMENT_PLAN_NOT_READY' };
  }
  const sourceArchiveValidation = await inspectRolloverPlanSourceArchive(db, plan);
  if (!sourceArchiveValidation.valid) {
    return {
      success: false,
      action: 'ROLLOVER_NOT_READY',
      sourceSeason,
      targetSeason,
      reason: sourceArchiveValidation.reason,
      writesStarted: false,
    };
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
          validatePlan: (candidate: any) => candidate?.mode !== 'recovery_carry_forward' &&
            validateRolloverPlan(candidate, sourceSeason, targetSeason).valid &&
            isRolloverPlanPublicationReady(candidate) &&
            isPlanBoundToValidatedSourceArchive(sourceArchiveValidation, candidate),
          publicationDeadlineMs: overdueSequentialPublication ? preparedStartMs : lifecycle!.publicationDeadlineAt.getTime(),
          activationAtMs: overdueSequentialPublication ? preparedStartMs : lifecycle!.activationAt.getTime(),
          allowOverdueRecovery: overdueSequentialPublication,
          activationEndAtMs: overdueSequentialPublication ? preparedNextStartMs : undefined,
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
      publicationDeadline: overdueSequentialPublication ? new Date(preparedStartMs).toISOString() : lifecycle!.publicationDeadlineAt.toISOString(),
      activationAt: overdueSequentialPublication ? new Date(preparedStartMs).toISOString() : lifecycle!.activationAt.toISOString(),
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

  // The activation transaction may have committed immediately before a
  // process/cron interruption. On retry, prepared* fields are already deleted;
  // resume only the pending cleanup for the season that is already active.
  const activationRetry = resolvePostActivationRetry(initial);
  if (activationRetry.ready) {
    let cleanup: any = null;
    try {
      cleanup = await pruneSeasonHistoryAfterActivation(db, activationRetry.targetSeason,
        initial.retainedArchiveSeason !== null && initial.retainedArchiveSeason !== undefined &&
        Number.isSafeInteger(Number(initial.retainedArchiveSeason))
          ? Number(initial.retainedArchiveSeason) : null);
      const completion = await completeSeasonHistoryCleanup(db, activationRetry.targetSeason);
      if (!completion.ready) throw new Error(completion.reason || 'HISTORY_CLEANUP_COMPLETION_BLOCKED');
    } catch (error: any) {
      cleanup = { pending: true, error: String(error?.message || error) };
    }
    return {
      success: true,
      action: 'SEASON_ALREADY_ACTIVATED',
      sourceSeason: activationRetry.sourceSeason,
      targetSeason: activationRetry.targetSeason,
      worldReady: true,
      historyCleanup: cleanup,
      resumedAfterInterruption: true,
    };
  }

  const sourceSeason = Number(initial.activeSeasonNumber || 1);
  const targetSeason = Number(initial.preparedSeasonNumber || initial.nextSeasonNumber || 0);
  const recoveryMode = initial.preparedRecoveryMode === true;
  if (recoveryMode) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'SEQUENTIAL_RECOVERY_MODE_DISABLED', sourceSeason, targetSeason, writesStarted: false };
  }
  if (!Number.isSafeInteger(targetSeason) || targetSeason !== sourceSeason + 1) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'INVALID_ACTIVATION_TARGET', sourceSeason, targetSeason };
  }
  // Revalidate immediately before activation as well: a Cup removed or
  // corrupted after publication must block the season boundary.
  const cupPreparation = await preparePyramidCupForSeason(targetSeason);
  if (cupPreparation.success !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'PYRAMID_CUP_PREPARATION_BLOCKED', cupPreparation, sourceSeason, targetSeason, writesStarted: false };
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
  const activationPlanSnap = await planRef.get();
  const activationPlan = activationPlanSnap.exists ? activationPlanSnap.data() || {} : null;
  if (!activationPlan ||
      activationPlan?.mode === 'recovery_carry_forward' ||
      !validateRolloverPlan(activationPlan, sourceSeason, targetSeason).valid ||
      !isRolloverPlanPublicationReady(activationPlan)) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'ROLLOVER_PLAN_INVALID', sourceSeason, targetSeason, writesStarted: false };
  }
  const sourceArchiveValidation = await inspectRolloverPlanSourceArchive(db, activationPlan);
  if (!sourceArchiveValidation.valid) {
    return { success: false, action: 'WORLD_NOT_READY', reason: sourceArchiveValidation.reason, sourceSeason, targetSeason, writesStarted: false };
  }

  const readiness = await inspectCanonicalSeason(db, targetSeason);
  if (!readiness.ready) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'CANONICAL_CALENDAR_INCOMPLETE', sourceSeason, targetSeason, ...readiness };
  }

  const result = await commitSeasonActivation(db, configRef, planRef, {
    sourceSeason,
    targetSeason,
    calendarRevision: CALENDAR_REVISION,
    activationAtMs,
    nextSeasonStartMs: preparedNextStartMs,
    multiSeasonRecovery: false,
    recoveryMode: false,
    isPlanReady: (plan) => plan?.mode !== 'recovery_carry_forward' &&
      validateRolloverPlan(plan, sourceSeason, targetSeason).valid &&
      isRolloverPlanPublicationReady(plan) &&
      isPlanBoundToValidatedSourceArchive(sourceArchiveValidation, plan),
    buildUpdate: (current, plan) => ({
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
      preparedRecoveryMode: FieldValue.delete(),
      preparedRolloverPlanSignature: FieldValue.delete(),
      recoveryTargetSeason: FieldValue.delete(),
      retainedArchiveSeason: sourceSeason,
      historyCleanupPending: true,
      historyCleanupTargetSeason: targetSeason,
      lastRecoverySkippedSeasons: FieldValue.delete(),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  });

  if (result.success !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: result.reason || 'ACTIVATION_BLOCKED', sourceSeason, targetSeason, writesStarted: false };
  }
  const activatedPlanSnap = await planRef.get();
  const activatedPlan = activatedPlanSnap.exists ? activatedPlanSnap.data() || {} : {};
  const retainedArchiveSeason = recoveryMode
    ? (activatedPlan.retainedArchiveSeason !== null && activatedPlan.retainedArchiveSeason !== undefined && Number.isSafeInteger(Number(activatedPlan.retainedArchiveSeason)) ? Number(activatedPlan.retainedArchiveSeason) : null)
    : sourceSeason;
  let cleanup: any = null;
  try {
    cleanup = await pruneSeasonHistoryAfterActivation(db, targetSeason, retainedArchiveSeason);
    const completion = await completeSeasonHistoryCleanup(db, targetSeason);
    if (!completion.ready) throw new Error(completion.reason || 'HISTORY_CLEANUP_COMPLETION_BLOCKED');
  } catch (error: any) {
    cleanup = { pending: true, error: String(error?.message || error) };
  }
  return { success: true, action: 'SEASON_ACTIVATED', sourceSeason, targetSeason, worldReady: true, recoveryMode, historyCleanup: cleanup, activationAt: new Date(activationAtMs).toISOString(), ...readiness };
}


async function verifyInitialPyramidCup(db: any, seasonStartValue: any) {
  const id = 'cup_s1_lALPHA';
  const cupSnap = await db.collection('cup_pyramid_v1').doc(id).get();
  if (!cupSnap.exists) return { ready: false, reason: 'INITIAL_CUP_DOCUMENT_MISSING' };
  const cup = cupSnap.data() || {};
  const participants = Array.isArray(cup.participants) ? cup.participants : [];
  const firstRound = Array.isArray(cup.rounds?.r1) ? cup.rounds.r1 : [];
  const ordered = [...participants].sort((a: any, b: any) => Number(a.seed) - Number(b.seed));
  const eligible = ordered.filter((team: any) => Number(team.level) !== 1);
  const d1Ids = new Set<string>(participants.filter((team: any) => Number(team.level) === 1).map((team: any) => String(team.id || '')));
  const restTeams = Array.isArray(cup.openingRoundRestTeams) ? cup.openingRoundRestTeams : [];
  const restIds = new Set<string>(restTeams.map((team: any) => String(team.id || '')));
  if (Number(cup.season) !== 1 || cup.status !== 'active' ||
      cup.name !== 'Кубок Пирамиды' || Number(cup.currentRound) !== 1 || Number(cup.totalRounds) !== 7 ||
      Number(cup.formatVersion) !== 4 || cup.format !== 'D1_REST_OPENING_ROUND' ||
      Number(cup.totalParticipants) !== 120 || Number(cup.totalMatches) !== 119 || participants.length !== 120 ||
      !isCanonicalCupParticipantField(participants) ||
      !isCanonicalPyramidCupOpeningField(participants, firstRound, restTeams) ||
      new Set(participants.map((team: any) => String(team?.id || ''))).size !== 120 ||
      new Set(participants.map((team: any) => Number(team?.seed))).size !== 120 ||
      ordered.some((team: any, index: number) => Number(team?.seed) !== index + 1 || !team?.id) ||
      Number(cup.preliminaryMatches) !== 56 || Number(cup.byeCount) !== 0 ||
      Number(cup.openingRoundRestCount) !== 8 || restTeams.length !== 8 || restIds.size !== 8 ||
      d1Ids.size !== 8 || [...d1Ids].some(id => !restIds.has(id)) || [...restIds].some(id => !d1Ids.has(id)) ||
      restTeams.some((team: any) => Number(team.level) !== 1 || !participants.some((candidate: any) => candidate.id === team.id)) ||
      firstRound.length !== 56 || firstRound.some((pairing: any) => pairing?.status === 'bye')) {
    return { ready: false, reason: 'INITIAL_CUP_BRACKET_INVALID' };
  }

  const seasonStart = new Date(seasonStartValue);
  if (!Number.isFinite(seasonStart.getTime())) {
    return { ready: false, reason: 'INITIAL_CUP_SEASON_START_INVALID' };
  }
  const expectedKickoff = new Date(seasonStart.getTime() + 86400000);
  expectedKickoff.setUTCHours(4, 0, 0, 0);

  const participantSnapshots = await Promise.all(participants.map((team: any) =>
    db.collection('cup_participant_snapshots_v1').doc(id).collection('teams').doc(String(team.id)).get()
  ));
  const participantSnapshotById = new Map<string, any>();
  if (participantSnapshots.some((snapshot: any, index: number) => {
    if (!snapshot.exists) return true;
    const data = snapshot.data() || {};
    const teamId = String(participants[index]?.id || '');
    if (data.cupId !== id || Number(data.season) !== 1 || data.teamId !== teamId ||
        !isValidCupParticipantMatchSnapshot(data.matchSnapshot, teamId)) return true;
    participantSnapshotById.set(teamId, data.matchSnapshot);
    return false;
  })) {
    return { ready: false, reason: 'INITIAL_CUP_PARTICIPANT_SNAPSHOTS_INCOMPLETE' };
  }

  const invalidPairing = firstRound.some((pairing: any, index: number) => {
    const expectedId = `cup_S1_R1_M${String(index + 1).padStart(2, '0')}`;
    const stronger = eligible[eligible.length - 2 - index * 2];
    const weaker = eligible[eligible.length - 1 - index * 2];
    return pairing?.id !== `r1_m${index + 1}` || pairing?.matchId !== expectedId ||
      pairing?.status !== 'scheduled' ||
      pairing?.away?.id !== stronger?.id ||
      pairing?.home?.id !== weaker?.id;
  });
  if (invalidPairing) return { ready: false, reason: 'INITIAL_CUP_PAIRINGS_INVALID' };
  const fixtureSnapshots = await Promise.all(firstRound.map((_: any, index: number) => {
    const expectedId = `cup_S1_R1_M${String(index + 1).padStart(2, '0')}`;
    return db.collection(MATCH_COLLECTIONS.cup).doc(expectedId).get();
  }));
  if (fixtureSnapshots.some((fixture: any) => !fixture.exists)) {
    return { ready: false, reason: 'INITIAL_CUP_FIXTURES_INCOMPLETE' };
  }
  for (let index = 0; index < fixtureSnapshots.length; index++) {
    const fixture = fixtureSnapshots[index].data() || {};
    const pairing = firstRound[index];
    const scheduledAtMs = fixture.scheduledAt?.toMillis?.() ?? Date.parse(String(fixture.scheduledAt || ''));
    if (fixture.cupId !== id || Number(fixture.season) !== 1 ||
        Number(fixture.cupRound) !== 1 || fixture.bestOf !== 1 ||
        fixture.homeId !== pairing.home.id || fixture.awayId !== pairing.away.id ||
        scheduledAtMs !== expectedKickoff.getTime() ||
        !isCupParticipantMatchSnapshotCompatible(
          fixture.homeTeamSnapshot,
          participantSnapshotById.get(pairing.home.id),
          pairing.home.id,
        ) ||
        !isCupParticipantMatchSnapshotCompatible(
          fixture.awayTeamSnapshot,
          participantSnapshotById.get(pairing.away.id),
          pairing.away.id,
        )) {
      return { ready: false, reason: 'INITIAL_CUP_FIXTURE_IDENTITY_INVALID', matchId: fixture.id || null };
    }
  }


  return { ready: true, participants: 120, totalMatches: 119, preliminaryMatches: 56, openingRoundRestCount: 8, byes: 0 };
}

/**
 * Serialize all calendar builders, including callers that reuse an existing
 * rollover plan. The lease is fenced by owner and token before every batch or
 * publication write, so an expired process cannot publish a new world.
 */
export async function ensureSeasonCalendar(
  requestedTargetSeason?: number,
  options: { allowDuringStagingReset?: boolean } = {},
) {
  const db = getAdminDb();
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  let config = configSnap.exists ? configSnap.data() || {} : {};
  // The reset executor is the only caller allowed to build the calendar while
  // the reset marker is asserted. Every ordinary cron/user path fails closed.
  if ((config.stagingSeasonOneResetInProgress === true || config.stagingFreshSeasonOneReset === true) &&
      options.allowDuringStagingReset !== true) {
    return {
      success: false,
      worldReady: false,
      action: 'WORLD_BUILDING',
      reason: 'STAGING_SEASON_ONE_RESET_IN_PROGRESS',
      writesStarted: false,
    };
  }
  if (config.historyCleanupPending === true) {
    try {
      await pruneSeasonHistoryAfterActivation(db, Number(config.historyCleanupTargetSeason || config.activeSeasonNumber || 1),
        config.retainedArchiveSeason !== null && config.retainedArchiveSeason !== undefined && Number.isSafeInteger(Number(config.retainedArchiveSeason)) ? Number(config.retainedArchiveSeason) : null);
      const completion = await completeSeasonHistoryCleanup(db, Number(config.historyCleanupTargetSeason || config.activeSeasonNumber || 1));
      if (!completion.ready) throw new Error(completion.reason || 'HISTORY_CLEANUP_COMPLETION_BLOCKED');
      config = { ...config, historyCleanupPending: false };
    } catch (error: any) {
      return { success: false, worldReady: config.worldReady === true, action: 'WORLD_BUILDING', reason: 'SEASON_HISTORY_CLEANUP_PENDING', cleanupError: String(error?.message || error), writesStarted: true };
    }
  }
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
    const [system, tables, slots, matches, players, cupBrackets, cupMatches] = await Promise.all([
      db.collection('system_v1').limit(1).get(),
      db.collection('league_tables_v2').limit(1).get(),
      db.collection('league_slots_v1').limit(1).get(),
      db.collection('matches_v2').limit(1).get(),
      db.collection('players_v14').limit(1).get(),
      db.collection('cup_pyramid_v1').limit(1).get(),
      db.collection(MATCH_COLLECTIONS.cup).limit(1).get(),
    ]);
    pristineFirstWorld = [system, tables, slots, matches, players, cupBrackets, cupMatches]
      .every((snapshot: any) => snapshot.empty === true || snapshot.size === 0);
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

  // A delayed cron may observe several elapsed boundaries, but it may only
  // prepare the immediate successor. Each intervening season must be activated
  // and completed through the same archive and rollover gates before advancing.
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
    if (config.worldGeneration === 'CLEAN_S1_V1' && resolvedWindow.source !== 'CLEAN_S1_V1') {
      return { success: false, worldReady: false, action: 'WORLD_BUILDING', reason: 'CLEAN_SEASON_TIMELINE_INVALID', writesStarted: false };
    }
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

    if (datePlan.expectedSeasonNumber > sourceSeason) {
      targetSeason = resolveNextSeasonTarget(sourceSeason, datePlan.expectedSeasonNumber);
    }
    if (targetSeason > sourceSeason) {
      targetSeason = resolveNextSeasonTarget(sourceSeason, targetSeason);
    }
  }

  // Even an explicit or stale requested target is clamped to the immediate
  // successor. This also covers pristine bootstrap callers that supply a target.
  if (targetSeason > sourceSeason) {
    targetSeason = resolveNextSeasonTarget(sourceSeason, targetSeason);
  }
  // A project-fenced Beta reset explicitly marks the active Season 1 as
  // rebuilding after its old S1 fixtures have been removed. In this one
  // controlled state, the source-season fixture preflight must not reject the
  // intentionally empty calendar. Normal calls retain the full integrity gate.
  const stagingFreshSeasonOneReset =
    config.stagingFreshSeasonOneReset === true &&
    sourceSeason === 1 &&
    targetSeason === 1 &&
    config.worldReady !== true;
  const beforeLockPreflight = pristineFirstWorld || stagingFreshSeasonOneReset
    ? { ready: true, observedCanonicalMatches: 0, diagnostics: [] as any[] }
    : await inspectCalendarRepairPreflight(db, sourceSeason);
  const canClassifyIncompleteSource = targetSeason > sourceSeason &&
    Number(beforeLockPreflight.observedCanonicalMatches || 0) < TOTAL_GROUPS * 56;
  if (!beforeLockPreflight.ready && !canClassifyIncompleteSource) {
    return { success: false, worldReady: false, action: 'WORLD_BUILDING', reason: 'SEASON_CALENDAR_PREFLIGHT_FAILED', diagnostics: beforeLockPreflight.diagnostics, writesStarted: false };
  }
  const lock = await acquireSeasonCalendarBuildLock(db, sourceSeason, targetSeason, {
    allowDuringStagingReset: options.allowDuringStagingReset === true,
  });
  if (!lock.acquired) {
    return {
      success: false,
      worldReady: false,
      seasonNumber: sourceSeason,
      targetSeasonNumber: targetSeason,
      action: 'WORLD_BUILDING',
      reason: lock.reason || 'SEASON_CALENDAR_BUILD_LOCKED',
      lockExpiresAtMs: lock.expiresAtMs,
    };
  }
  const lease: BuildLease = {
    assert: async () => { await assertSeasonCalendarBuildLock(db, lock.ownerId, lock.token); },
    commit: writes => commitSeasonCalendarWrites(db, lock.ownerId, lock.token, writes, {
      allowDuringStagingReset: options.allowDuringStagingReset === true,
    }),
  };
  try {
    const lockedPreflight = pristineFirstWorld || stagingFreshSeasonOneReset
      ? { ready: true, observedCanonicalMatches: 0, diagnostics: [] as any[] }
      : await inspectCalendarRepairPreflight(db, sourceSeason);
    const canClassifyLockedIncompleteSource = targetSeason > sourceSeason &&
      Number(lockedPreflight.observedCanonicalMatches || 0) < TOTAL_GROUPS * 56;
    if (!lockedPreflight.ready && !canClassifyLockedIncompleteSource) {
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
      const planSource = sourceSeason;
      const plan = planSnap.exists ? planSnap.data() || {} : null;
      const publishedReady = latestConfig.preparedWorldReady === true &&
        validateRolloverPlan(plan, planSource, targetSeason).valid &&
        isRolloverPlanPublicationReady(plan) &&
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
        recoveryTargetSeason: FieldValue.delete(),
        preparedWorldReady: config.preparedWorldReady === true && Number(config.preparedSeasonNumber) === targetSeason,
        updatedAt: FieldValue.serverTimestamp(),
      }, options: { merge: true } }]);
    }
    const world: any = await buildSeasonCalendar(lease, pristineFirstWorld);
    const cupRequired = pristineFirstWorld || (config.pyramidCupRequired === true && Number(config.activeSeasonNumber || 1) === 1 && Number(config.pyramidCupReadySeasonNumber) === 1);
    const cupPending = cupRequired && config.pyramidCupReady !== true;
    if (!cupPending || world?.success !== true || world?.worldReady !== true) return world;

    try {
      const pyramidCup = await generatePyramidCup(1, { allowInitialBootstrap: true });
      const verification = await verifyInitialPyramidCup(db, world.seasonStart || config.seasonStart);
      if (verification.ready !== true) throw new Error(verification.reason || 'INITIAL_CUP_VERIFICATION_FAILED');
      await db.collection('system_v1').doc('season_config').set({
        pyramidCupRequired: true,
        pyramidCupReady: true,
        pyramidCupReadySeasonNumber: 1,
        // Keep the dedicated reset fence asserted until the reset executor's
        // final verification transaction clears both markers atomically.
        stagingFreshSeasonOneReset: config.stagingFreshSeasonOneReset === true,
        pyramidCupReadyAt: FieldValue.serverTimestamp(),
        pyramidCupError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ...world, pyramidCup, pyramidCupVerification: verification };
    } catch (error: any) {
      const reason = String(error?.message || error || 'INITIAL_PYRAMID_CUP_PREPARATION_FAILED');
      await db.collection('system_v1').doc('season_config').set({
        worldReady: false,
        phase: 'REGULAR_SEASON',
        pyramidCupRequired: true,
        pyramidCupReady: false,
        pyramidCupReadySeasonNumber: 1,
        pyramidCupError: reason,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ...world,
        success: false,
        worldReady: false,
        action: 'WORLD_BUILDING',
        reason: 'INITIAL_PYRAMID_CUP_PREPARATION_FAILED',
        pyramidCupError: reason,
      };
    }
  } finally {
    await releaseSeasonCalendarBuildLock(db, lock.ownerId, lock.token);
  }
}
