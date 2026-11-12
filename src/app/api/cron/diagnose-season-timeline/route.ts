import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '../cron-auth';
import { deriveSeasonDatePlan } from '@/app/actions/season-boundary';
import { diagnoseSeasonRolloverPreflight } from '@/app/actions/season-rollover';
import { isCompletedSeasonArchive, validateSeasonArchiveSnapshot } from '@/app/actions/season-archive';
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

    const elapsedSeasons = plan.completedSeasons;
    const archiveChecks: any[] = [];
    let historyReady = true;

    for (const seasonNumber of elapsedSeasons) {
      const archiveRef = db.collection('league_season_archives_v1').doc(`S${seasonNumber}`);
      const rolloverRef = db.collection('league_season_rollovers_v1').doc(`S${seasonNumber + 1}`);
      const [archiveSnap, rolloverSnap] = await Promise.all([archiveRef.get(), rolloverRef.get()]);
      const archive = archiveSnap.exists ? archiveSnap.data() || {} : null;
      const matchesSnap = archiveSnap.exists ? await archiveRef.collection('matches').get() : null;
      const matches = matchesSnap
        ? matchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }))
        : [];
      const archiveValidation = archive
        ? validateSeasonArchiveSnapshot(archive, matches)
        : { valid: false, reasons: ['ARCHIVE_MISSING'] };
      const completed = Boolean(archive && isCompletedSeasonArchive(archive) && archiveValidation.valid);
      const rollover = rolloverSnap.exists ? rolloverSnap.data() || {} : null;
      const rolloverValidation = validateRolloverPlan(rollover, seasonNumber, seasonNumber + 1);
      const valid = completed && rolloverValidation.valid;
      if (!valid) historyReady = false;
      archiveChecks.push({
        seasonNumber,
        status: valid ? 'verified_completed' : 'blocked',
        archiveExists: archiveSnap.exists,
        archiveStatus: archive?.status || null,
        archivedMatches: matches.length,
        archiveValid: archiveValidation.valid,
        archiveReasons: archiveValidation.reasons,
        rolloverPlanExists: rolloverSnap.exists,
        rolloverPlanValid: rolloverValidation.valid,
        rolloverReasons: rolloverValidation.reasons || [],
      });
    }

    const currentSeasonNumber = plan.expectedSeasonNumber;
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
        completedSeasonsToVerify: elapsedSeasons,
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
        ? 'REPAIR_OR_RECONCILE_ELAPSED_SEASON_HISTORY'
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
