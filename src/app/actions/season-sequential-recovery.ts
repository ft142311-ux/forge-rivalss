import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { buildSeasonTwoRecoveryDocuments, isValidSeasonTwoRecoveryResult, runWithConcurrency } from './season-recovery-core';
import { evaluateCanonicalDocuments } from './season-canonical';
import { validateRolloverPlan } from './season-rollover-plan';
import { isCompletedSeasonArchive, validateSeasonArchiveSnapshot } from './season-archive';
import { acquireSeasonRolloverLock, assertSeasonRolloverLock, commitSeasonRolloverWrites, releaseSeasonRolloverLock, acquireSeasonCalendarBuildLock, releaseSeasonCalendarBuildLock, commitSeasonCalendarPublication } from './season-rollover-lock';
import { prepareSeasonRollover } from './season-rollover';
import { resolveUniversalMatchDocument } from './universal-match-resolver';
import { rebuildLeagueTablesFromFinishedMatches, resolveDailyMatches } from './autonomous-cycle';
import { buildMatchTeamSnapshot } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { ensureSeasonCalendar, publishPreparedSeason } from './season-calendar';
import { TOTAL_CYCLE_DAYS } from '@/app/lib/leagues-data';

const S1_START = '2026-09-21T15:00:00.000Z';
const S2_START = '2026-10-08T15:00:00.000Z';
const S3_START = '2026-10-23T15:00:00.000Z';
const S4_START = '2026-11-07T15:00:00.000Z';
const CALENDAR_REVISION = 4;
const WRITE_CHUNK = 400;

/** Rebuild the missing historical S2 with explicit reconstruction metadata, then catch up to scheduled S3. */
export async function reconstructSeasonTwoAndActivateSeasonThree() {
  const db = getAdminDb();
  const configRef = db.doc('system_v1/season_config');
  const s1ArchiveRef = db.doc('league_season_archives_v1/S1');
  const s1MatchesRef = db.collection('league_season_archives_v1/S1/matches');
  const s2PlanRef = db.doc('league_season_rollovers_v1/S2');
  const s2ArchiveRef = db.doc('league_season_archives_v1/S2');

  const [configSnap, s1ArchiveSnap, s1MatchesSnap, s2PlanSnap, existingS2ArchiveSnap, existingMatches, existingTables, existingSlots] = await Promise.all([
    configRef.get(), s1ArchiveRef.get(), s1MatchesRef.get(), s2PlanRef.get(), s2ArchiveRef.get(),
    db.collection('matches_v2').where('season', '==', 2).get(),
    db.collection('league_tables_v2').where('season', '==', 2).get(),
    db.collection('league_slots_v1').where('season', '==', 2).get(),
  ]);
  const config = configSnap.exists ? configSnap.data() || {} : {};
  const s1Archive = s1ArchiveSnap.data() || {};
  const s1Matches = s1MatchesSnap.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
  const s2Plan = s2PlanSnap.exists ? s2PlanSnap.data() || {} : null;

  if (!configSnap.exists || Number(config.activeSeasonNumber) !== 1 || config.phase !== 'REGULAR_SEASON' ||
      config.worldReady !== true || config.seasonStart !== S1_START || config.nextSeasonStart !== S2_START) {
    return { success: false, reason: 'SEASON_1_CONFIG_MISMATCH', writesStarted: false };
  }
  if (!isCompletedSeasonArchive(s1Archive) || !validateSeasonArchiveSnapshot(s1Archive, s1Matches).valid ||
      !validateRolloverPlan(s2Plan, 1, 2).valid) {
    return { success: false, reason: 'SEASON_1_ARCHIVE_OR_S2_PLAN_INVALID', writesStarted: false };
  }
  if (existingS2ArchiveSnap.exists && existingS2ArchiveSnap.data()?.status === 'completed') {
    return { success: false, reason: 'S2_ALREADY_ARCHIVED_REQUIRES_RESUME_REVIEW', writesStarted: false };
  }

  const seasonStart = new Date(S2_START);
  const built = buildSeasonTwoRecoveryDocuments(s2Plan, seasonStart);
  const expectedMatchIds = new Set(built.matches.map(item => item.id));
  if (existingMatches.docs.some(doc => !expectedMatchIds.has(doc.id) && String(doc.data()?.type || doc.data()?.matchType || 'league').toLowerCase() === 'league')) {
    return { success: false, reason: 'UNEXPECTED_S2_MATCH_DOCUMENTS', writesStarted: false };
  }
  if (existingTables.size || existingSlots.size) {
    return { success: false, reason: 'PARTIAL_S2_WORLD_REQUIRES_REVIEW', existingTables: existingTables.size, existingSlots: existingSlots.size, writesStarted: false };
  }

  const participantIds = [...new Set(built.matches.flatMap(item => [String(item.data.homeId), String(item.data.awayId)]))];
  const profileSnaps = await Promise.all(participantIds.map(id => db.collection('players_v14').doc(id).get()));
  const missingProfiles = profileSnaps.filter(snap => !snap.exists).map(snap => snap.id);
  if (missingProfiles.length) return { success: false, reason: 'S2_PARTICIPANT_PROFILE_MISSING', ids: missingProfiles, writesStarted: false };
  const profileById = new Map(profileSnaps.map(snap => [snap.id, snap.data() || {}]));

  // Validate every planned result in memory before acquiring the write lease.
  for (const match of built.matches) {
    const home = profileById.get(String(match.data.homeId)) || {};
    const away = profileById.get(String(match.data.awayId)) || {};
    const simulation = runMatchEngine({
      mode: 'league',
      matchId: match.id,
      teamA: buildMatchTeamSnapshot(home, match.data.homeName, String(match.data.homeId), 'league'),
      teamB: buildMatchTeamSnapshot(away, match.data.awayName, String(match.data.awayId), 'league'),
      bestOf: 2,
    });
    const [scoreA, scoreB] = String(simulation.seriesScore || '').split('-').map(Number);
    if (!isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA, scoreB })) {
      return { success: false, reason: 'S2_SIMULATION_PREFLIGHT_INVALID', matchId: match.id, writesStarted: false };
    }
  }

  let rolloverLock = await acquireSeasonRolloverLock(db, 1, 2);
  if (!rolloverLock.acquired) return { success: false, reason: 'SEASON_ROLLOVER_LOCKED', writesStarted: false };
  let writesStarted = false;
  try {
    await assertSeasonRolloverLock(db, rolloverLock.ownerId, rolloverLock.token);
    const [freshConfig, freshS1Archive, freshS1Matches, freshPlan, freshS2Matches, freshS2Tables, freshS2Slots] = await Promise.all([
      configRef.get(), s1ArchiveRef.get(), s1MatchesRef.get(), s2PlanRef.get(),
      db.collection('matches_v2').where('season', '==', 2).get(),
      db.collection('league_tables_v2').where('season', '==', 2).get(),
      db.collection('league_slots_v1').where('season', '==', 2).get(),
    ]);
    const latestConfig = freshConfig.data() || {};
    const latestS1Archive = freshS1Archive.data() || {};
    const latestS1Matches = freshS1Matches.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
    if (Number(latestConfig.activeSeasonNumber) !== 1 || latestConfig.phase !== 'REGULAR_SEASON' ||
        latestConfig.worldReady !== true || latestConfig.seasonStart !== S1_START || latestConfig.nextSeasonStart !== S2_START ||
        !isCompletedSeasonArchive(latestS1Archive) || !validateSeasonArchiveSnapshot(latestS1Archive, latestS1Matches).valid ||
        !validateRolloverPlan(freshPlan.data(), 1, 2).valid || freshS2Matches.size || freshS2Tables.size || freshS2Slots.size) {
      return { success: false, reason: 'S2_RECONSTRUCTION_PREFLIGHT_CHANGED', writesStarted: false };
    }

    const pendingWorldWrites = [
      ...built.tables.map(item => ({ ref: db.collection('league_tables_v2').doc(item.id), data: item.data })),
      ...built.slots.map(item => ({ ref: db.collection('league_slots_v1').doc(item.id), data: item.data })),
      ...built.matches.map(item => ({ ref: db.collection('matches_v2').doc(item.id), data: item.data })),
    ];
    for (let offset = 0; offset < pendingWorldWrites.length; offset += WRITE_CHUNK) {
      await assertSeasonRolloverLock(db, rolloverLock.ownerId, rolloverLock.token);
      await commitSeasonRolloverWrites(db, rolloverLock.ownerId, rolloverLock.token, pendingWorldWrites.slice(offset, offset + WRITE_CHUNK));
      writesStarted = true;
    }

    const [tablesSnap, slotsSnap, matchesSnap] = await Promise.all([
      db.collection('league_tables_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 2).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
    ]);
    const canonical = evaluateCanonicalDocuments({ tables: tablesSnap.docs, slots: slotsSnap.docs, matches: matchesSnap.docs });
    if (!canonical.ready || matchesSnap.size !== 840) return { success: false, reason: 'S2_CANONICAL_WORLD_INVALID', diagnostics: canonical.reasons, writesStarted };

    let simulationErrors: Array<{ matchId: string; error: string }> = [];
    await runWithConcurrency(matchesSnap.docs, 5, async doc => {
      try {
        const result = await resolveUniversalMatchDocument(doc.id, { rolloverLock: { ownerId: rolloverLock.ownerId, token: rolloverLock.token } });
        if (result.finished !== true) throw new Error(result.status || 'S2_MATCH_NOT_FINISHED');
      } catch (error: any) {
        simulationErrors.push({ matchId: doc.id, error: String(error?.message || 'S2_MATCH_SIMULATION_FAILED') });
      }
    });
    if (simulationErrors.length) return { success: false, reason: 'S2_SIMULATION_PARTIAL', errors: simulationErrors.slice(0, 20), simulatedMatches: 840 - simulationErrors.length, writesStarted: true };
  } finally {
    await releaseSeasonRolloverLock(db, rolloverLock.ownerId, rolloverLock.token);
  }

  const standingsSync = await rebuildLeagueTablesFromFinishedMatches(db, 2);
  if (!standingsSync.success || standingsSync.finishedMatches !== 840) {
    return { success: false, reason: 'S2_STANDINGS_REBUILD_FAILED', diagnostics: standingsSync.diagnostics, writesStarted: true };
  }

  const s2Rollover = await prepareSeasonRollover(db, 2, 3);
  if (s2Rollover.ready !== true) return { success: false, reason: 'S2_ARCHIVE_OR_S3_PLAN_BLOCKED', rollover: s2Rollover, writesStarted: true };

  const s2ArchiveSnap = await s2ArchiveRef.get();
  const s2ArchiveMatchesSnap = await s2ArchiveRef.collection('matches').get();
  const s2Archive = s2ArchiveSnap.data() || {};
  const s2ArchiveMatches = s2ArchiveMatchesSnap.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
  const s3PlanSnap = await db.doc('league_season_rollovers_v1/S3').get();
  if (!isCompletedSeasonArchive(s2Archive) || !validateSeasonArchiveSnapshot(s2Archive, s2ArchiveMatches).valid ||
      !validateRolloverPlan(s3PlanSnap.data(), 2, 3).valid) {
    return { success: false, reason: 'S2_ARCHIVE_OR_S3_PLAN_POSTCHECK_FAILED', writesStarted: true };
  }

  const reconstructedAt = FieldValue.serverTimestamp();
  await s2ArchiveRef.set({
    completionMode: 'late_engine_reconstruction',
    reconstruction: {
      method: 'shared-match-engine',
      engineVersion: 'simulateMatchCore',
      simulatedMatches: 840,
      preservedPriorResults: 0,
      historicalRosterSnapshotAvailable: false,
      rosterSource: 'saved player profiles at recovery time',
      reconstructedAt,
    },
    integrity: { ...(s2Archive.integrity || {}), reconstructed: true },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const calendarLock = await acquireSeasonCalendarBuildLock(db, 1, 2);
  if (!calendarLock.acquired) return { success: false, reason: 'S2_PUBLICATION_LOCKED', writesStarted: true };
  let s2Published = false;
  try {
    const lockRef = db.collection('system_v1').doc('season_calendar_build_v1');
    const staged = await db.runTransaction(async tx => {
      const [lockSnap, configNow, archiveNow, planNow] = await Promise.all([
        tx.get(lockRef), tx.get(configRef), tx.get(s2ArchiveRef), tx.get(s2PlanRef),
      ]);
      const lockData = lockSnap.exists ? lockSnap.data() || {} : {};
      const current = configNow.exists ? configNow.data() || {} : {};
      const archiveData = archiveNow.exists ? archiveNow.data() || {} : {};
      const planData = planNow.exists ? planNow.data() || {} : {};
      if (lockData.ownerId !== calendarLock.ownerId || lockData.token !== calendarLock.token ||
          Number(lockData.expiresAtMs || 0) <= Date.now() || Number(current.activeSeasonNumber) !== 1 ||
          current.worldReady !== true || !isCompletedSeasonArchive(archiveData) ||
          !validateRolloverPlan(planData, 1, 2).valid) return false;
      tx.set(configRef, {
        phase: 'GENERATING_NEXT', nextSeasonNumber: 2, preparationTargetSeason: 2,
        worldReady: false, seasonStart: S2_START, nextSeasonStart: S3_START,
        calendarRevision: CALENDAR_REVISION, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!staged) return { success: false, reason: 'S2_PUBLICATION_STAGE_GUARD_FAILED', writesStarted: true };

    await commitSeasonCalendarPublication(db, calendarLock.ownerId, calendarLock.token, {
      sourceSeason: 1,
      targetSeason: 2,
      calendarRevision: CALENDAR_REVISION,
      phase: 'GENERATING_NEXT',
      planRef: s2PlanRef,
      validatePlan: candidate => validateRolloverPlan(candidate, 1, 2).valid,
    }, {
      ref: configRef,
      data: {
        activeSeasonNumber: 2, phase: 'REGULAR_SEASON', worldReady: true,
        seasonStart: S2_START, nextSeasonStart: S3_START,
        calendarRevision: CALENDAR_REVISION,
        nextSeasonNumber: FieldValue.delete(), preparationTargetSeason: FieldValue.delete(), recoveryTargetSeason: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      options: { merge: true },
    });
    s2Published = true;
  } finally {
    await releaseSeasonCalendarBuildLock(db, calendarLock.ownerId, calendarLock.token);
  }

  if (!s2Published) return { success: false, reason: 'S2_PUBLICATION_NOT_COMMITTED', writesStarted: true };
  const s3Calendar: any = await ensureSeasonCalendar();
  if (s3Calendar?.success !== true || s3Calendar?.seasonNumber !== 3 || s3Calendar?.prepared !== true) {
    return { success: false, reason: 'S3_CALENDAR_PREPARATION_BLOCKED', s2ArchiveStatus: s2Archive.status, s2Rollover, calendar: s3Calendar, writesStarted: true };
  }
  const s3Publication: any = await publishPreparedSeason();
  if (s3Publication?.success !== true) return { success: false, reason: 'S3_PUBLICATION_BLOCKED', s2ArchiveStatus: s2Archive.status, s2Rollover, calendar: s3Calendar, publication: s3Publication, writesStarted: true };

  const s3MatchSettlement = await resolveDailyMatches();
  const finalConfig = (await configRef.get()).data() || {};
  const finalS2ArchiveSnap = await s2ArchiveRef.get();
  const finalS2ArchiveMatches = (await s2ArchiveRef.collection('matches').get()).docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
  const finalS2Archive = finalS2ArchiveSnap.data() || {};
  const finalS3Plan = (await db.doc('league_season_rollovers_v1/S3').get()).data() || {};
  const finalChecks = isCompletedSeasonArchive(finalS2Archive) &&
    validateSeasonArchiveSnapshot(finalS2Archive, finalS2ArchiveMatches).valid &&
    validateRolloverPlan(finalS3Plan, 2, 3).valid &&
    Number(finalConfig.activeSeasonNumber) === 3 && finalConfig.worldReady === true &&
    finalConfig.seasonStart === S3_START && finalConfig.nextSeasonStart === S4_START;
  return {
    success: finalChecks,
    sourceSeason: 1,
    reconstructedSeason: 2,
    activeSeason: finalConfig.activeSeasonNumber,
    nextSeasonStart: finalConfig.nextSeasonStart,
    s2: { archiveStatus: finalS2Archive.status, archivedMatches: finalS2ArchiveMatches.length, reconstructedMatches: Number(finalS2Archive.reconstruction?.simulatedMatches || 0), awards: s2Rollover.awards || null },
    s3: { published: s3Publication.success === true, seasonStart: finalConfig.seasonStart, nextSeasonStart: finalConfig.nextSeasonStart, matchSettlement: s3MatchSettlement },
    s4: { scheduledStart: S4_START, activated: false },
    writesStarted: true,
  };
}
