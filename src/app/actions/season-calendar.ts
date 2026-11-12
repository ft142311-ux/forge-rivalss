import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { prepareSeasonRollover } from './season-rollover';
import { acquireSeasonCalendarBuildLock, assertSeasonCalendarBuildLock, commitSeasonCalendarPublication, commitSeasonCalendarWrites, releaseSeasonCalendarBuildLock } from './season-rollover-lock';
import { buildCarryForwardGroups, buildPromotionRelegationGroups, resolveRecoveryPlacementSource, resolveRolloverPlanPruneIds, validateRolloverPlan } from './season-rollover-plan';
import { resolveSeasonCatchUpPolicy, type SeasonHistoryState } from './season-history-policy';
import { evaluateCanonicalDocuments } from './season-canonical';
import { inspectGroupReconciliation } from './season-rollover-standings';
import { getAdminDb } from '@/lib/firebase-admin';
import { advanceAtMostOneSeasonBoundary, deriveRecoverySeasonWindow, deriveSeasonDatePlan, resolveCanonicalSeasonDateWindow, resolveNextSeasonTarget, resolveSeasonActivationWindow, resolveSeasonLifecycleWindow } from './season-boundary';
import { FIRST_SEASON_NEXT_START_ISO } from '@/app/lib/time-utils';
import { buildRecoveredSeasonArchiveSnapshot, isCompletedSeasonArchive, isRecoveredSeasonArchive, resolveArchivePrunePlan, validateSeasonArchiveSnapshot } from './season-archive';
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
      const id = occupantId || (status === 'FREE' ? getBotId(LEAGUE_ID, level, group, rank) : '');
      if (!id || (status !== 'FREE' && status !== 'OCCUPIED')) {
        return { ready: false, reason: 'RECOVERED_ARCHIVE_SLOT_IDENTITY_UNTRUSTED', slotId: slotDoc.id, status };
      }
      if (!sourceGroups[key]) sourceGroups[key] = [];
      sourceGroups[key].push({ id, name: String(slot.occupantName || id), rank });
    }
    const snapshot = buildRecoveredSeasonArchiveSnapshot({
      sourceSeason: seasonNumber,
      startingParticipants: sourceGroups,
      finishedMatches: Number(liveState.finishedMatches || 0),
      reason: String(liveState.reason || 'SEASON_INCOMPLETE'),
    });
    if (!snapshot.ready) return snapshot;
    const archiveRef = db.collection('league_season_archives_v1').doc(`S${seasonNumber}`);
    await archiveRef.set(snapshot.archive);
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
        if (!recovered.ready) {
          return { ready: false, reason: 'INCOMPLETE_SEASON_RECOVERY_SNAPSHOT_FAILED', details: { seasonNumber: season, recovery: recovered } };
        }
        states[season] = { status: 'incomplete', reason: liveState.reason || 'SEASON_INCOMPLETE' };
        latestRecoveredParticipants = { season, groups: recovered.archive.startingParticipants };
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
      if (!recovered.ready) {
        return { ready: false, reason: 'INCOMPLETE_SEASON_RECOVERY_SNAPSHOT_FAILED', details: { seasonNumber: season, recovery: recovered } };
      }
      states[season] = { status: 'incomplete', reason: liveState.reason || 'SEASON_INCOMPLETE' };
      if (!latestRecoveredParticipants || season > latestRecoveredParticipants.season) {
        latestRecoveredParticipants = { season, groups: recovered.archive.startingParticipants };
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
      const id = occupantId || (status === 'FREE' ? getBotId(LEAGUE_ID, level, group, rank) : '');
      if (!id || (status !== 'FREE' && status !== 'OCCUPIED')) {
        return { ready: false, reason: 'ACTIVE_SEASON_SLOT_IDENTITY_UNTRUSTED', details: { slotId: doc.id, status } };
      }
      if (!sourceGroups[key]) sourceGroups[key] = [];
      sourceGroups[key].push({ id, name: String(slot.occupantName || id), rank });
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
    promotionRule: latestCompletedArchive ? 'apply_latest_verified_completed_season_once' : 'carry_forward_without_promotion_or_relegation',
    groups,
    createdAt: FieldValue.serverTimestamp(),
  };
  const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  await planRef.set(plan);

  const historyBatch = db.batch();
  for (const skipped of policy.skippedSeasons) {
    historyBatch.set(db.collection('league_season_history_v1').doc(`S${skipped.seasonNumber}`), {
      seasonNumber: skipped.seasonNumber,
      status: 'SKIPPED_PENDING_ACTIVATION',
      reason: skipped.reason,
      targetSeason,
      noResultsFabricated: true,
      awardsApplied: false,
      promotionRelegationApplied: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  if (policy.skippedSeasons.length) await historyBatch.commit();

  return { ready: true, plan, skippedSeasons: policy.skippedSeasons, retainedArchiveSeason: policy.retainedArchiveSeason };
}

async function buildSeasonCalendar(lease: BuildLease, pristineFirstWorld = false) {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await configRef.get();
  const current = configSnap.exists ? configSnap.data() || {} : {};

  // Strip stale rank-9/duplicate rows before rollover reads the official table.
  // This preserves scores and the existing eight canonical ranks.
  const sourceSeasonNumber = Number(current.activeSeasonNumber || 1);
  const recoveryTarget = Number(current.recoveryTargetSeason || 0);
  const requestedRecoveryTarget = Number(current.nextSeasonNumber || current.preparationTargetSeason || current.preparedSeasonNumber || 0);
  const directRecovery = recoveryTarget > sourceSeasonNumber + 1 || requestedRecoveryTarget > sourceSeasonNumber + 1;
  const now = new Date();
  const sourceRepairPreflight = directRecovery || requestedRecoveryTarget <= sourceSeasonNumber
    ? null
    : await inspectCalendarRepairPreflight(db, sourceSeasonNumber);
  const sourceFixturesIncomplete = Boolean(sourceRepairPreflight &&
    Number(sourceRepairPreflight.observedCanonicalMatches || 0) < TOTAL_GROUPS * 56);
  const repairedSourceTables = directRecovery || sourceFixturesIncomplete
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

  // Preserve the source world's actual next boundary before the one-step
  // scheduler advances its local cursor. Multi-season recovery must derive from
  // this persisted boundary, including CLEAN_S1_V1's custom first-season span.
  const sourceNextBoundary = new Date(nextBoundary.getTime());

  // Normal progression advances one boundary per invocation. A date-derived
  // recovery target may override this below only after every elapsed season is
  // classified as completed (and archived) or genuinely incomplete (skipped).
  if (!pristineFirstWorld) {
    const boundaryStep = advanceAtMostOneSeasonBoundary(seasonNumber, seasonStart, nextBoundary, now, TOTAL_CYCLE_DAYS);
    seasonNumber = boundaryStep.seasonNumber;
    seasonStart = boundaryStep.seasonStart;
    nextBoundary = boundaryStep.nextBoundary;
  }

  if (directRecovery) {
    // Recovery is allowed to bypass unavailable intermediate seasons only
    // after their persisted results have been classified and a verified
    // carry-forward/placement plan has been prepared. Derive dates from the
    // source world's real next boundary rather than a hard-coded S1 timestamp.
    const recoveryWindow = deriveRecoverySeasonWindow(
      sourceSeasonNumber,
      sourceNextBoundary,
      recoveryTarget,
      TOTAL_CYCLE_DAYS,
    );
    seasonNumber = recoveryTarget;
    seasonStart = recoveryWindow.seasonStart;
    nextBoundary = recoveryWindow.nextSeasonStart;
  }

  const phase = String(current.phase || '').toUpperCase();
  const requestedTarget = Number(current.nextSeasonNumber || current.preparationTargetSeason || 0);
  const transitionRequested = ['FINALIZING', 'GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED'].includes(phase) || (phase === 'WORLD_BUILDING' && requestedTarget > Number(current.activeSeasonNumber || 1));
  if (transitionRequested && !directRecovery) {
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

  // Never build a target world without a verified placement plan. Normal
  // transitions require a completed archive; recovery plans explicitly mark
  // incomplete seasons as skipped and carry forward only trusted team identities.
  let rolloverPlan: any = null;
  const activeSeasonBefore = Number(current.activeSeasonNumber || 1);
  if (configSnap.exists && seasonChanged && seasonNumber > activeSeasonBefore) {
    const planSourceSeason = directRecovery ? seasonNumber - 1 : activeSeasonBefore;
    const planSnap = await db.collection('league_season_rollovers_v1').doc(`S${seasonNumber}`).get();
    const savedPlan = planSnap.exists ? planSnap.data() || {} : null;
    if (savedPlan && validateRolloverPlan(savedPlan, planSourceSeason, seasonNumber).valid &&
        (!directRecovery || savedPlan.mode === 'recovery_carry_forward')) {
      rolloverPlan = savedPlan;
    } else if (directRecovery) {
      const recovery = await prepareRecoveryCarryForwardPlan(db, activeSeasonBefore, seasonNumber);
      if (!recovery.ready) {
        return {
          success: false,
          seasonNumber: activeSeasonBefore,
          targetSeasonNumber: seasonNumber,
          worldReady: false,
          waitingForSeasonResults: true,
          rollover: { ready: false, reason: recovery.reason, details: recovery.details },
          writesStarted: false,
        };
      }
      rolloverPlan = recovery.plan;
    } else {
      const rollover = await prepareSeasonRollover(db, activeSeasonBefore, seasonNumber);
      if (!rollover.ready) {
        const canSkipIncompleteSeason = rollover.writesStarted !== true &&
          ['SEASON_RESULTS_INCOMPLETE', 'SEASON_STANDINGS_PREFLIGHT_FAILED'].includes(String(rollover.reason || ''));
        if (!canSkipIncompleteSeason) {
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
        const recovery = await prepareRecoveryCarryForwardPlan(db, activeSeasonBefore, seasonNumber);
        if (!recovery.ready) {
          return {
            success: false,
            seasonNumber: activeSeasonBefore,
            targetSeasonNumber: seasonNumber,
            worldReady: false,
            waitingForSeasonResults: true,
            rollover: { ready: false, reason: recovery.reason, details: recovery.details, originalRollover: rollover },
            writesStarted: false,
          };
        }
        rolloverPlan = recovery.plan;
      }
      if (!rolloverPlan) {
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
        preparedRecoveryMode: directRecovery || rolloverPlan?.mode === 'recovery_carry_forward',
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
      preparedRecoveryMode: directRecovery,
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


/**
 * Enforce the rolling one-archive policy only after a season has activated.
 * Verify the retained archive before deleting anything; delete nested match
 * documents explicitly because Firestore does not cascade subcollections.
 */
async function pruneSeasonHistoryAfterActivation(
  db: any,
  targetSeason: number,
  retainedArchiveSeason: number | null,
) {
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  const activeConfig = configSnap.exists ? configSnap.data() || {} : null;
  if (!activeConfig || Number(activeConfig.activeSeasonNumber) !== targetSeason || activeConfig.worldReady !== true) {
    throw new Error('SEASON_HISTORY_CLEANUP_TARGET_NOT_ACTIVE');
  }

  const activePlanRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const activePlanSnap = await activePlanRef.get();
  const activePlan = activePlanSnap.exists ? activePlanSnap.data() || {} : null;
  if (!validateRolloverPlan(activePlan, targetSeason - 1, targetSeason).valid) {
    throw new Error('ACTIVATED_SEASON_ROLLOVER_PLAN_MISSING_OR_INVALID');
  }

  const [archivesSnap, historySnap, plansSnap] = await Promise.all([
    db.collection('league_season_archives_v1').get(),
    db.collection('league_season_history_v1').get(),
    db.collection('league_season_rollovers_v1').get(),
  ]);
  const historyById = new Map<string, any>(historySnap.docs.map((doc: any): [string, any] => [doc.id, doc.data() || {}]));
  const archiveItems = [];
  for (const archiveDoc of archivesSnap.docs) {
    const archive = archiveDoc.data() || {};
    const pruningForThisTarget = archive.pruneStatus === 'PRUNING' &&
      Number(archive.pruneTargetSeason) === targetSeason &&
      Number(archive.pruneRetainedArchiveSeason || 0) === Number(retainedArchiveSeason || 0) &&
      Number(archive.prunePolicyVersion) === 1;
    const matchesSnap = pruningForThisTarget
      ? null
      : await archiveDoc.ref.collection('matches').get();
    archiveItems.push({
      id: archiveDoc.id,
      ref: archiveDoc.ref,
      archive,
      matches: matchesSnap ? matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id })) : [],
      historyStatus: String((historyById.get(archiveDoc.id) || {}).status || ''),
    });
  }
  const archivePlan = resolveArchivePrunePlan(
    archiveItems.map(({ id, archive, matches, historyStatus }) => ({ id, archive, matches, historyStatus })),
    targetSeason,
    retainedArchiveSeason,
  );
  if (!archivePlan.ready) throw new Error(archivePlan.reason || 'ARCHIVE_PRUNE_PREFLIGHT_FAILED');

  const rolloverPlan = resolveRolloverPlanPruneIds(
    plansSnap.docs.map((doc: any) => ({ id: doc.id, plan: doc.data() || {} })),
    targetSeason,
  );
  if (!rolloverPlan.ready) throw new Error(rolloverPlan.reason || 'ROLLOVER_PLAN_PRUNE_PREFLIGHT_FAILED');

  // Persist a deletion intent only after every archive and plan passed
  // validation. A retry can resume child-document deletion after interruption.
  for (const archiveId of archivePlan.pruneIds) {
    const item = archiveItems.find(candidate => candidate.id === archiveId)!;
    if (item.archive.pruneStatus !== 'PRUNING') {
      await item.ref.set({
        pruneStatus: 'PRUNING',
        pruneTargetSeason: targetSeason,
        pruneRetainedArchiveSeason: retainedArchiveSeason,
        prunePolicyVersion: 1,
        pruneStartedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  let deletedArchives = 0;
  let deletedArchiveMatches = 0;
  for (const archiveId of archivePlan.pruneIds) {
    const item = archiveItems.find(candidate => candidate.id === archiveId)!;
    const matchesSnap = await item.ref.collection('matches').get();
    for (let offset = 0; offset < matchesSnap.docs.length; offset += 400) {
      const batch = db.batch();
      const chunk = matchesSnap.docs.slice(offset, offset + 400);
      for (const matchDoc of chunk) batch.delete(matchDoc.ref);
      await batch.commit();
      deletedArchiveMatches += chunk.length;
    }
    await item.ref.delete();
    deletedArchives++;
  }

  let deletedRolloverPlans = 0;
  for (let offset = 0; offset < rolloverPlan.pruneIds.length; offset += 400) {
    const batch = db.batch();
    const chunk = rolloverPlan.pruneIds.slice(offset, offset + 400);
    for (const planId of chunk) batch.delete(db.collection('league_season_rollovers_v1').doc(planId));
    if (chunk.length) await batch.commit();
    deletedRolloverPlans += chunk.length;
  }
  return {
    deletedArchives,
    deletedArchiveMatches,
    deletedRolloverPlans,
    retainedArchiveSeason,
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
  const multiSeasonRecovery = recoveryMode && targetSeason > sourceSeason + 1;
  if (!Number.isSafeInteger(targetSeason) || (targetSeason !== sourceSeason + 1 && !multiSeasonRecovery)) {
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
      (multiSeasonRecovery || preparedStartMs === new Date(initial.nextSeasonStart || '').getTime()) &&
      preparedNextStartMs === preparedStartMs + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000 &&
      validateRolloverPlan(plan, recoveryMode ? targetSeason - 1 : sourceSeason, targetSeason).valid &&
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
  const overdueRecoveryMode = recoveryMode && Date.now() >= preparedStartMs;
  if (overdueRecoveryMode) {
    const nowMs = Date.now();
    if (!Number.isFinite(preparedStartMs) || !Number.isFinite(preparedNextStartMs) ||
        preparedNextStartMs !== preparedStartMs + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000 ||
        nowMs < preparedStartMs || nowMs >= preparedNextStartMs) {
      return { success: false, action: 'WORLD_BUILDING', reason: 'RECOVERY_PUBLICATION_OUTSIDE_TARGET_SEASON_WINDOW', sourceSeason, targetSeason, writesStarted: false };
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
  if (!plan || !validateRolloverPlan(plan, planSourceSeason, targetSeason).valid) {
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
          validatePlan: (candidate: any) => validateRolloverPlan(candidate, planSourceSeason, targetSeason).valid,
          publicationDeadlineMs: overdueRecoveryMode ? preparedStartMs : lifecycle!.publicationDeadlineAt.getTime(),
          activationAtMs: overdueRecoveryMode ? preparedStartMs : lifecycle!.activationAt.getTime(),
          allowOverdueRecovery: overdueRecoveryMode,
          activationEndAtMs: overdueRecoveryMode ? preparedNextStartMs : undefined,
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
      publicationDeadline: overdueRecoveryMode ? new Date(preparedStartMs).toISOString() : lifecycle!.publicationDeadlineAt.toISOString(),
      activationAt: overdueRecoveryMode ? new Date(preparedStartMs).toISOString() : lifecycle!.activationAt.toISOString(),
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
  const recoveryMode = initial.preparedRecoveryMode === true;
  const multiSeasonRecovery = recoveryMode && targetSeason > sourceSeason + 1;
  if (!Number.isSafeInteger(targetSeason) || (targetSeason !== sourceSeason + 1 && !multiSeasonRecovery)) {
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
        (!multiSeasonRecovery && new Date(current.nextSeasonStart || '').getTime() !== activationAtMs) ||
        (recoveryMode && current.preparedRecoveryMode !== true)) {
      return { success: false, reason: 'ACTIVATION_STATE_CHANGED' };
    }
    const transactionNowMs = Date.now();
    if (transactionNowMs < activationAtMs) return { success: false, reason: 'ACTIVATION_NOT_DUE' };
    if (transactionNowMs >= preparedNextStartMs) return { success: false, reason: 'ACTIVATION_WINDOW_EXPIRED' };
    if (!validateRolloverPlan(plan, recoveryMode ? targetSeason - 1 : sourceSeason, targetSeason).valid) {
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
      preparedRecoveryMode: FieldValue.delete(),
      recoveryTargetSeason: FieldValue.delete(),
      retainedArchiveSeason: recoveryMode ? (plan.retainedArchiveSeason !== null && plan.retainedArchiveSeason !== undefined && Number.isSafeInteger(Number(plan.retainedArchiveSeason)) ? Number(plan.retainedArchiveSeason) : null) : sourceSeason,
      historyCleanupPending: true,
      historyCleanupTargetSeason: targetSeason,
      lastRecoverySkippedSeasons: recoveryMode ? (Array.isArray(plan.skippedSeasons) ? plan.skippedSeasons : []) : FieldValue.delete(),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true };
  });

  if (result.success !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: result.reason || 'ACTIVATION_BLOCKED', sourceSeason, targetSeason, writesStarted: false };
  }
  const activatedPlanSnap = await planRef.get();
  const activatedPlan = activatedPlanSnap.exists ? activatedPlanSnap.data() || {} : {};
  if (recoveryMode) {
    const skipped = Array.isArray(activatedPlan.skippedSeasons) ? activatedPlan.skippedSeasons : [];
    for (let offset = 0; offset < skipped.length; offset += 400) {
      const batch = db.batch();
      for (const item of skipped.slice(offset, offset + 400)) {
        batch.set(db.collection('league_season_history_v1').doc(`S${Number(item.seasonNumber)}`), {
          status: 'SKIPPED', activatedTargetSeason: targetSeason, activatedAt: FieldValue.serverTimestamp(),
          noResultsFabricated: true, awardsApplied: false, promotionRelegationApplied: false,
        }, { merge: true });
      }
      await batch.commit();
    }
  }
  const retainedArchiveSeason = recoveryMode
    ? (activatedPlan.retainedArchiveSeason !== null && activatedPlan.retainedArchiveSeason !== undefined && Number.isSafeInteger(Number(activatedPlan.retainedArchiveSeason)) ? Number(activatedPlan.retainedArchiveSeason) : null)
    : sourceSeason;
  let cleanup: any = null;
  try {
    cleanup = await pruneSeasonHistoryAfterActivation(db, targetSeason, retainedArchiveSeason);
    await configRef.set({ historyCleanupPending: false, historyCleanupCompletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error: any) {
    cleanup = { pending: true, error: String(error?.message || error) };
  }
  return { success: true, action: 'SEASON_ACTIVATED', sourceSeason, targetSeason, worldReady: true, recoveryMode, historyCleanup: cleanup, activationAt: new Date(activationAtMs).toISOString(), ...readiness };
}

/**
 * Serialize all calendar builders, including callers that reuse an existing
 * rollover plan. The lease is fenced by owner and token before every batch or
 * publication write, so an expired process cannot publish a new world.
 */
export async function ensureSeasonCalendar(requestedTargetSeason?: number) {
  const db = getAdminDb();
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  let config = configSnap.exists ? configSnap.data() || {} : {};
  if (config.historyCleanupPending === true) {
    try {
      await pruneSeasonHistoryAfterActivation(db, Number(config.historyCleanupTargetSeason || config.activeSeasonNumber || 1),
        config.retainedArchiveSeason !== null && config.retainedArchiveSeason !== undefined && Number.isSafeInteger(Number(config.retainedArchiveSeason)) ? Number(config.retainedArchiveSeason) : null);
      await db.collection('system_v1').doc('season_config').set({ historyCleanupPending: false, historyCleanupCompletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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

  // A delayed cron may find several elapsed boundaries. Completed seasons are
  // archived; genuinely incomplete seasons may be skipped. The final target is
  // always the season currently active according to the canonical date plan.
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

    if (datePlan.expectedSeasonNumber > sourceSeason + 1) {
      targetSeason = datePlan.expectedSeasonNumber;
    }
  }

  const directRecoveryBuild = targetSeason > sourceSeason + 1;
  const beforeLockPreflight = pristineFirstWorld || directRecoveryBuild
    ? { ready: true, observedCanonicalMatches: 0, diagnostics: [] as any[] }
    : await inspectCalendarRepairPreflight(db, sourceSeason);
  const canClassifyIncompleteSource = targetSeason > sourceSeason &&
    Number(beforeLockPreflight.observedCanonicalMatches || 0) < TOTAL_GROUPS * 56;
  if (!beforeLockPreflight.ready && !canClassifyIncompleteSource) {
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
        ...(directRecoveryBuild ? { recoveryTargetSeason: targetSeason } : {}),
        preparedWorldReady: config.preparedWorldReady === true && Number(config.preparedSeasonNumber) === targetSeason,
        updatedAt: FieldValue.serverTimestamp(),
      }, options: { merge: true } }]);
    }
    return await buildSeasonCalendar(lease, pristineFirstWorld);
  } finally {
    await releaseSeasonCalendarBuildLock(db, lock.ownerId, lock.token);
  }
}
