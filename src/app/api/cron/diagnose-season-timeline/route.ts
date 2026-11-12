import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '../cron-auth';
import { deriveSeasonDatePlan } from '@/app/actions/season-boundary';
import { diagnoseSeasonRolloverPreflight } from '@/app/actions/season-rollover';
import { isCompletedSeasonArchive, isRecoveredSeasonArchive, validateSeasonArchiveSnapshot } from '@/app/actions/season-archive';
import { validateRolloverPlan } from '@/app/actions/season-rollover-plan';
import { TOTAL_CYCLE_DAYS } from '@/app/lib/leagues-data';

export const maxDuration = 120;

/**
 * Read-only timeline audit. It compares the persisted active marker with the
 * season implied by the canonical calendar, validates every elapsed archive
 * and rollover plan in order, and inspects (but never repairs) the date-active
 * season's existing fixtures. No user profiles or private player data are read.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const db = getAdminDb();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    if (!configSnap.exists) {
      return NextResponse.json({
        success: false, readOnly: true, writesStarted: false,
        action: 'SEASON_TIMELINE_DIAGNOSTIC_BLOCKED',
        reason: 'SEASON_CONFIG_MISSING',
      }, { status: 409 });
    }

    const config = configSnap.data() || {};
    const persistedSeason = Number(config.activeSeasonNumber || 1);
    const seasonStart = new Date(config.seasonStart || '');
    const nextSeasonStart = new Date(config.nextSeasonStart || '');
    const now = new Date();
    const plan = deriveSeasonDatePlan(
      persistedSeason,
      seasonStart,
      nextSeasonStart,
      now,
      TOTAL_CYCLE_DAYS,
    );

    // Rolling retention allows older seasons to be absent. Inspect the
    // immediately preceding season for completion/skip status, and inspect
    // older retained archives only to identify the newest valid archive.
    const currentSeasonNumber = plan.expectedSeasonNumber;
    const latestPreviousSeason = currentSeasonNumber - 1;
    const archiveChecks: any[] = [];
    let historyReady = true;
    let retainedArchiveSeason: number | null = null;
    let skippedSeason: { seasonNumber: number; reason: string; observedMatches: number; finishedMatches: number } | null = null;
    let skippedSeasons: Array<{ seasonNumber: number; reason: string }> = [];
    const olderArchiveSeasons: number[] = [];
    const invalidOlderArchives: number[] = [];

    if (latestPreviousSeason >= 1) {
      const archiveRef = db.collection('league_season_archives_v1').doc(`S${latestPreviousSeason}`);
      const rolloverRef = db.collection('league_season_rollovers_v1').doc(`S${currentSeasonNumber}`);
      const [archiveSnap, rolloverSnap, sourceMatchesSnap, allArchivesSnap, historyMarkersSnap] = await Promise.all([
        archiveRef.get(),
        rolloverRef.get(),
        db.collection('matches_v2')
          .where('season', '==', latestPreviousSeason)
          .where('version', '==', 140)
          .get(),
        db.collection('league_season_archives_v1').get(),
        db.collection('league_season_history_v1').get(),
      ]);
      const archive = archiveSnap.exists ? archiveSnap.data() || {} : null;
      const archivedMatchesSnap = archiveSnap.exists ? await archiveRef.collection('matches').get() : null;
      const archivedMatches = archivedMatchesSnap
        ? archivedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }))
        : [];
      const archiveValidation = archive
        ? validateSeasonArchiveSnapshot(archive, archivedMatches)
        : { valid: false, reasons: ['ARCHIVE_MISSING'] };
      const completedArchive = Boolean(archive && isCompletedSeasonArchive(archive) && archiveValidation.valid);
      const recoveredIncompleteArchive = Boolean(archive && isRecoveredSeasonArchive(archive));
      const unverifiableExistingArchive = Boolean(archiveSnap.exists && !completedArchive && !recoveredIncompleteArchive);
      const rollover = rolloverSnap.exists ? rolloverSnap.data() || {} : null;
      const rolloverValidation = validateRolloverPlan(rollover, latestPreviousSeason, currentSeasonNumber);
      if (!rolloverValidation.valid) historyReady = false;

      // A previous completed archive may be older than the immediately
      // preceding season when one or more later seasons were skipped.
      for (const olderDoc of allArchivesSnap.docs) {
        const match = /^S(\d+)$/.exec(olderDoc.id);
        const seasonNumber = match ? Number(match[1]) : NaN;
        if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1 || seasonNumber >= latestPreviousSeason) continue;
        const older = olderDoc.data() || {};
        if (String(older.status || '') === 'recovered') continue;
        if (!isCompletedSeasonArchive(older)) { invalidOlderArchives.push(seasonNumber); continue; }
        const olderMatchesSnap = await olderDoc.ref.collection('matches').get();
        const olderMatches = olderMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
        const validation = validateSeasonArchiveSnapshot(older, olderMatches);
        if (validation.valid) olderArchiveSeasons.push(seasonNumber);
        else invalidOlderArchives.push(seasonNumber);
      }
      if (olderArchiveSeasons.length) retainedArchiveSeason = Math.max(...olderArchiveSeasons);
      if (invalidOlderArchives.some(season => season > (retainedArchiveSeason ?? 0))) historyReady = false;

      const canonical = sourceMatchesSnap.docs.filter((doc: any) => {
        const match = doc.data() || {};
        const type = String(match.type || match.matchType || match.competitionType || '').toLowerCase();
        if (/(cup|tournament|friendly|scrim|pyramid)/.test(type) || match.isCup === true ||
            match.isFriendly === true || match.tournamentId || match.cupId) return false;
        const level = Number(match.level || match.division || 0);
        const group = Number(match.groupId || match.group || 0);
        const homeRank = Number(match.homeRank || 0);
        const awayRank = Number(match.awayRank || 0);
        return level >= 1 && level <= 4 && group >= 1 && group <= Math.pow(2, level - 1) &&
          homeRank >= 1 && homeRank <= 8 && awayRank >= 1 && awayRank <= 8 &&
          homeRank !== awayRank && (!match.leagueId || String(match.leagueId) === 'ALPHA');
      });
      const uniqueFixtures = new Set(canonical.map((doc: any) => {
        const match = doc.data() || {};
        return `${Number(match.level || match.division)}:${Number(match.groupId || match.group)}:${Number(match.homeRank)}:${Number(match.awayRank)}`;
      }));
      const groupCounts = new Map<string, number>();
      const resultState = canonical.map((doc: any) => {
        const match = doc.data() || {};
        const groupKey = `${Number(match.level || match.division)}:${Number(match.groupId || match.group)}`;
        groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
        const home = Number(match.seriesScore?.home ?? match.scoreA);
        const away = Number(match.seriesScore?.away ?? match.scoreB);
        const validScore = Number.isInteger(home) && Number.isInteger(away) &&
          home >= 0 && away >= 0 && home <= 2 && away <= 2 && (home > 0 || away > 0);
        return {
          unfinished: match.isFinished !== true,
          validFinished: match.isFinished === true &&
            String(match.status || '').toLowerCase() === 'finished' && validScore,
          invalidFinished: match.isFinished === true &&
            (String(match.status || '').toLowerCase() !== 'finished' || !validScore),
        };
      });
      const finished = resultState.filter((item: any) => item.validFinished).length;
      const unfinished = resultState.filter((item: any) => item.unfinished).length;
      const invalidFinished = resultState.filter((item: any) => item.invalidFinished).length;
      const hasIntegrityConflict = uniqueFixtures.size !== canonical.length || canonical.length > 840 ||
        invalidFinished > 0 || [...groupCounts.values()].some(count => count > 56);
      const completeResultSet = canonical.length === 840 && finished === 840 &&
        groupCounts.size === 15 && [...groupCounts.values()].every(count => count === 56);
      const actuallyIncomplete = canonical.length < 840 || unfinished > 0;

      if (completedArchive) {
        retainedArchiveSeason = latestPreviousSeason;
        archiveChecks.push({
          seasonNumber: latestPreviousSeason,
          status: rolloverValidation.valid ? 'verified_completed' : 'blocked_rollover_plan',
          archiveExists: true,
          archiveStatus: archive?.status || null,
          archivedMatches: archivedMatches.length,
          archiveValid: true,
          rolloverPlanExists: rolloverSnap.exists,
          rolloverPlanValid: rolloverValidation.valid,
          rolloverReasons: 'reason' in rolloverValidation ? [rolloverValidation.reason] : [],
        });
      } else if (recoveredIncompleteArchive) {
        skippedSeason = {
          seasonNumber: latestPreviousSeason,
          reason: 'RECOVERED_INCOMPLETE_SEASON',
          observedMatches: canonical.length,
          finishedMatches: finished,
        };
        archiveChecks.push({
          seasonNumber: latestPreviousSeason,
          status: 'skipped_incomplete',
          archiveExists: true,
          archiveStatus: archive?.status || null,
          reason: skippedSeason.reason,
          rolloverPlanValid: rolloverValidation.valid,
        });
      } else if (hasIntegrityConflict || unverifiableExistingArchive) {
        historyReady = false;
        archiveChecks.push({
          seasonNumber: latestPreviousSeason,
          status: 'blocked_integrity_conflict',
          archiveExists: archiveSnap.exists,
          archiveStatus: archive?.status || null,
          archivedMatches: archivedMatches.length,
          archiveValid: archiveValidation.valid,
          archiveReasons: archiveValidation.reasons,
          canonicalMatches: canonical.length,
          uniqueCanonicalFixtures: uniqueFixtures.size,
          finishedMatches: finished,
          unfinishedMatches: unfinished,
          invalidFinishedResults: invalidFinished,
          rolloverPlanValid: rolloverValidation.valid,
        });
      } else if (actuallyIncomplete) {
        skippedSeason = {
          seasonNumber: latestPreviousSeason,
          reason: canonical.length === 0 ? 'NO_CANONICAL_RESULTS' : 'SEASON_INCOMPLETE',
          observedMatches: canonical.length,
          finishedMatches: finished,
        };
        archiveChecks.push({
          seasonNumber: latestPreviousSeason,
          status: 'skipped_incomplete',
          archiveExists: archiveSnap.exists,
          canonicalMatches: canonical.length,
          finishedMatches: finished,
          unfinishedMatches: unfinished,
          reason: skippedSeason.reason,
          rolloverPlanValid: rolloverValidation.valid,
        });
      } else if (completeResultSet) {
        historyReady = false;
        archiveChecks.push({
          seasonNumber: latestPreviousSeason,
          status: 'blocked_completed_archive_required',
          archiveExists: archiveSnap.exists,
          archiveValid: archiveValidation.valid,
          archiveReasons: archiveValidation.reasons,
          canonicalMatches: canonical.length,
          finishedMatches: finished,
          rolloverPlanValid: rolloverValidation.valid,
        });
      } else {
        historyReady = false;
        archiveChecks.push({
          seasonNumber: latestPreviousSeason,
          status: 'blocked_inconsistent_result_set',
          canonicalMatches: canonical.length,
          finishedMatches: finished,
          rolloverPlanValid: rolloverValidation.valid,
        });
      }

      const markerSkippedSeasons = historyMarkersSnap.docs
        .map((doc: any) => ({ ...(doc.data() || {}), seasonNumber: Number((doc.data() || {}).seasonNumber || doc.id.replace(/^S/, '')) }))
        .filter((item: any) => item.seasonNumber >= 1 && item.seasonNumber < currentSeasonNumber &&
          ['SKIPPED', 'SKIPPED_PENDING_ACTIVATION'].includes(String(item.status || '')))
        .map((item: any) => ({ seasonNumber: item.seasonNumber, reason: String(item.reason || 'SEASON_INCOMPLETE') }));
      skippedSeasons = [...new Map([
        ...markerSkippedSeasons,
        ...(skippedSeason ? [{ seasonNumber: skippedSeason.seasonNumber, reason: skippedSeason.reason }] : []),
      ].map((item: any) => [item.seasonNumber, item])).values()].sort((a: any, b: any) => a.seasonNumber - b.seasonNumber);

    }
    const [currentMatchesSnap, currentPreflight] = await Promise.all([
      db.collection('matches_v2')
        .where('season', '==', currentSeasonNumber)
        .where('version', '==', 140)
        .get(),
      diagnoseSeasonRolloverPreflight(db, currentSeasonNumber, false),
    ]);
    const currentMatches = currentMatchesSnap.docs;
    const finishedMatches = currentMatches.filter((doc: any) => {
      const data = doc.data() || {};
      return data.isFinished === true && String(data.status || '').toLowerCase() === 'finished';
    }).length;
    const currentSeasonReadyToContinue = currentPreflight.ready === true &&
      currentPreflight.observedMatches === 840 &&
      currentPreflight.observedTables === 15;

    return NextResponse.json({
      success: true,
      readOnly: true,
      writesStarted: false,
      timestamp: now.toISOString(),
      persisted: {
        activeSeasonNumber: persistedSeason,
        seasonStart: config.seasonStart || null,
        nextSeasonStart: config.nextSeasonStart || null,
        phase: config.phase || null,
        worldReady: config.worldReady === true,
      },
      calendar: {
        expectedActiveSeason: currentSeasonNumber,
        expectedSeasonStart: plan.expectedSeasonStart.toISOString(),
        expectedNextSeasonStart: plan.expectedNextSeasonStart.toISOString(),
        seasons: plan.seasons.map(item => ({
          seasonNumber: item.seasonNumber,
          seasonStart: item.seasonStart.toISOString(),
          nextSeasonStart: item.nextSeasonStart.toISOString(),
          status: item.status,
        })),
      },
      history: {
        ready: historyReady,
        retentionPolicy: { maxCompletedArchives: 1, retainedArchiveSeason, obsoleteArchiveSeasons: olderArchiveSeasons.filter(season => season !== retainedArchiveSeason) },
        latestPreviousSeason: latestPreviousSeason >= 1 ? latestPreviousSeason : null,
        skippedSeasons: skippedSeasons || (skippedSeason ? [skippedSeason] : []),
        olderValidArchiveSeasons: olderArchiveSeasons,
        invalidOlderArchives,
        archives: archiveChecks,
      },
      currentSeason: {
        seasonNumber: currentSeasonNumber,
        matchDocuments: currentMatches.length,
        finishedMatches,
        unfinishedOrInvalidMatches: currentMatches.length - finishedMatches,
        tablesObserved: currentPreflight.observedTables ?? null,
        canonicalPreflightReady: currentPreflight.ready === true,
        diagnostics: currentPreflight.diagnostics || [],
        readyToContinue: historyReady && currentSeasonReadyToContinue,
      },
      nextAction: !historyReady
        ? 'REPAIR_OR_RECONCILE_LATEST_SEASON_HISTORY'
        : currentSeasonReadyToContinue
          ? 'CONTINUE_DATE_ACTIVE_SEASON_WITH_EXISTING_RESULTS'
          : 'INSPECT_DATE_ACTIVE_SEASON_FIXTURES_WITHOUT_SIMULATION',
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      readOnly: true,
      writesStarted: false,
      action: 'SEASON_TIMELINE_DIAGNOSTIC_FAILED',
      error: String(error?.message || error),
    }, { status: 500 });
  }
}
