import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';
import { diagnoseSeasonRolloverPreflight } from '@/app/actions/season-rollover';
import { validateRolloverPlan } from '@/app/actions/season-rollover-plan';
import { isRolloverPlanPublicationReady } from '@/app/actions/season-awards-policy';
import { validateSeasonArchiveRolloverPlan, validateSeasonArchiveSnapshot } from '@/app/actions/season-archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPECTED_PROJECT = 'forge-rivals-beta';
const LEAGUE_ID = 'ALPHA';
const EXPECTED_CUP_PARTICIPANTS = 120;
const EXPECTED_CUP_MATCHES = 119;
const CUP_ID = 'cup_s1_lALPHA';
const CUP_COLLECTION = 'cup_pyramid_v1';
const SNAPSHOT_COLLECTION = 'cup_participant_snapshots_v1';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

function toDate(value: any): Date | null {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value?.toDate === 'function'
      ? value.toDate()
      : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isTerminalMatch(data: Record<string, any>) {
  return data.isFinished === true ||
    ['finished', 'completed'].includes(String(data.status || '').toLowerCase());
}

function isCanonicalLeagueMatch(data: Record<string, any>) {
  const type = String(data.matchType || data.type || data.competitionType || '').toLowerCase();
  return (!data.leagueId || String(data.leagueId) === LEAGUE_ID) &&
    !data.cupId && !data.tournamentId && !data.isFriendly &&
    !/(cup|tournament|friendly|scrim|association)/.test(type);
}

function safeReasonCodes(reasons: unknown) {
  return Array.isArray(reasons)
    ? [...new Set(reasons.map(value => String(value).split(':')[0]).filter(Boolean))].slice(0, 8)
    : [];
}

async function readSeasonDiagnostics(db: any, config: Record<string, any>) {
  const activeSeason = Number(config.activeSeasonNumber || 0);
  if (!Number.isSafeInteger(activeSeason) || activeSeason < 1) {
    return {
      activeSeason,
      phase: String(config.phase || ''),
      worldReady: config.worldReady === true,
      structureReady: false,
      reason: 'ACTIVE_SEASON_INVALID',
    };
  }

  const preparedSeasonNumber = Number(config.preparedSeasonNumber || 0);
  const hasPreparedSuccessor = preparedSeasonNumber === activeSeason + 1 &&
    config.preparedWorldReady === true;
  const preparedCupId = 'cup_s' + preparedSeasonNumber + '_lALPHA';
  const [
    tablesSnap,
    slotsSnap,
    matchesSnap,
    archiveSnap,
    archiveHistorySnap,
    rolloverPlanSnap,
    allArchivesSnap,
    preparedTablesSnap,
    preparedSlotsSnap,
    preparedMatchesSnap,
    preparedCupSnap,
    preparedCupSnapshots,
    preparedCupMatches,
  ] = await Promise.all([
    db.collection('league_tables_v2')
      .where('season', '==', activeSeason).where('version', '==', 140).get(),
    db.collection('league_slots_v1')
      .where('season', '==', activeSeason).where('leagueId', '==', LEAGUE_ID).get(),
    db.collection('matches_v2')
      .where('season', '==', activeSeason).where('version', '==', 140).get(),
    db.collection('league_season_archives_v1').doc('S' + activeSeason).get(),
    db.collection('league_season_history_v1').doc('S' + activeSeason).get(),
    db.collection('league_season_rollovers_v1').doc('S' + (activeSeason + 1)).get(),
    db.collection('league_season_archives_v1').get(),
    hasPreparedSuccessor
      ? db.collection('league_tables_v2').where('season', '==', preparedSeasonNumber).where('version', '==', 140).get()
      : Promise.resolve({ size: 0 }),
    hasPreparedSuccessor
      ? db.collection('league_slots_v1').where('season', '==', preparedSeasonNumber).where('leagueId', '==', LEAGUE_ID).get()
      : Promise.resolve({ size: 0 }),
    hasPreparedSuccessor
      ? db.collection('matches_v2').where('season', '==', preparedSeasonNumber).where('version', '==', 140).get()
      : Promise.resolve({ size: 0 }),
    hasPreparedSuccessor
      ? db.collection('cup_pyramid_v1').doc(preparedCupId).get()
      : Promise.resolve({ exists: false }),
    hasPreparedSuccessor
      ? db.collection('cup_participant_snapshots_v1').doc(preparedCupId).collection('teams').get()
      : Promise.resolve({ size: 0 }),
    hasPreparedSuccessor
      ? db.collection('cup_matches').where('cupId', '==', preparedCupId).get()
      : Promise.resolve({ size: 0 }),
  ]);

  const leagueMatches = matchesSnap.docs.filter((doc: any) => isCanonicalLeagueMatch(doc.data() || {}));
  const finishedMatches = leagueMatches.filter((doc: any) => isTerminalMatch(doc.data() || {})).length;
  const unresolvedMatches = leagueMatches.length - finishedMatches;
  let rolloverPreflight: any;
  try {
    const result = await diagnoseSeasonRolloverPreflight(db, activeSeason);
    rolloverPreflight = {
      structureReady: result.ready === true,
      observedTables: Number(result.observedTables || 0),
      observedMatches: Number(result.observedMatches || 0),
      diagnosticGroups: Array.isArray(result.diagnostics) ? result.diagnostics.length : 0,
    };
  } catch {
    rolloverPreflight = { structureReady: false, unavailable: true };
  }

  const plan = rolloverPlanSnap.exists ? rolloverPlanSnap.data() || {} : null;
  const planValidation = plan
    ? validateRolloverPlan(plan, activeSeason, activeSeason + 1)
    : { valid: false, reason: 'ROLLOVER_PLAN_MISSING' };
  const rolloverPlanReady = Boolean(
    plan &&
    plan.mode !== 'recovery_carry_forward' &&
    planValidation.valid &&
    isRolloverPlanPublicationReady(plan),
  );

  let archive: any = { exists: archiveSnap.exists, ready: false, matches: 0 };
  if (archiveSnap.exists) {
    const archiveMatchesSnap = await archiveSnap.ref.collection('matches').get();
    const archiveData = archiveSnap.data() || {};
    const archiveMatches = archiveMatchesSnap.docs.map((doc: any) => ({
      ...doc.data(),
      matchId: doc.id,
    }));
    const snapshotValidation = validateSeasonArchiveSnapshot(archiveData, archiveMatches);
    const planValidationForArchive = plan
      ? validateSeasonArchiveRolloverPlan(archiveData, plan)
      : { valid: false, reason: 'ROLLOVER_PLAN_MISSING' };
    archive = {
      exists: true,
      status: String(archiveData.status || ''),
      sourceSeason: Number(archiveData.sourceSeason || 0),
      expectedMatches: Number(archiveData.expectedMatches || 0),
      finishedMatches: Number(archiveData.finishedMatches || 0),
      matches: archiveMatchesSnap.size,
      snapshotValid: snapshotValidation.valid,
      rolloverPlanValid: planValidationForArchive.valid,
      ready: snapshotValidation.valid && planValidationForArchive.valid && rolloverPlanReady,
      snapshotReasonCodes: safeReasonCodes(snapshotValidation.reasons),
      rolloverReason: planValidationForArchive.valid ? null : String(planValidationForArchive.reason || 'ARCHIVE_ROLLOVER_INVALID'),
    };
  }

  const archiveSeasons = allArchivesSnap.docs
    .map((doc: any) => Number((doc.data() || {}).sourceSeason || doc.id.replace(/^S/, '')))
    .filter((season: number) => Number.isSafeInteger(season) && season > 0)
    .sort((a: number, b: number) => a - b);
  const phase = String(config.phase || '');
  const transitionRequested = ['FINALIZING', 'GENERATING_NEXT', 'WORLD_BUILDING', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED'].includes(phase);
  const expectedRetainedArchive = activeSeason > 1 ? activeSeason - 1 : null;
  const sourceArchivePresent = archiveSeasons.length === 1 && archiveSeasons[0] === activeSeason;
  const retainedArchiveMatchesPolicy = activeSeason === 1
    ? archiveSeasons.length === 0 || (sourceArchivePresent && archive.ready === true)
    : archiveSeasons.length === 1 && archiveSeasons[0] === expectedRetainedArchive;

  const nextSeasonStart = toDate(config.nextSeasonStart);
  const nextSeasonDue = Boolean(nextSeasonStart && Date.now() >= nextSeasonStart.getTime());
  const preparedSeasonStart = toDate(config.preparedSeasonStart);
  const preparedNextSeasonStart = toDate(config.preparedNextSeasonStart);
  const preparedStructureReady = hasPreparedSuccessor &&
    preparedTablesSnap.size === 15 &&
    preparedSlotsSnap.size === 120 &&
    preparedMatchesSnap.size === 840;

  const preparedCup = preparedCupSnap.exists ? preparedCupSnap.data() || {} : null;
  const preparedCupRounds = preparedCup && preparedCup.rounds && Array.isArray(preparedCup.rounds.r1)
    ? preparedCup.rounds.r1
    : [];
  const preparedCupParticipantCount = Array.isArray(preparedCup?.participants) ? preparedCup.participants.length : 0;
  const preparedCupReady = Boolean(
    hasPreparedSuccessor &&
    preparedCup &&
    Number(preparedCup.season) === preparedSeasonNumber &&
    preparedCup.status === 'active' &&
    Number(preparedCup.formatVersion) === 4 &&
    preparedCup.format === 'D1_REST_OPENING_ROUND' &&
    Number(preparedCup.totalParticipants) === 120 &&
    preparedCupParticipantCount === 120 &&
    Number(preparedCup.totalMatches) === 119 &&
    Number(preparedCup.preliminaryMatches) === 56 &&
    Array.isArray(preparedCup.openingRoundRestTeams) &&
    preparedCup.openingRoundRestTeams.length === 8 &&
    preparedCupSnapshots.size === 120 &&
    preparedCupMatches.size === 56 &&
    preparedCupRounds.length === 56 &&
    preparedCupRounds.every((pairing: any) =>
      pairing?.home?.id && pairing?.away?.id &&
      pairing?.home?.level !== 1 && pairing?.away?.level !== 1 &&
      pairing?.matchId
    ) &&
    preparedCup.openingRoundRestTeams.every((team: any) => Number(team?.level) === 1)
  );

  const transitionPrerequisitesReady = unresolvedMatches === 0 &&
    archive.ready === true &&
    rolloverPlanReady &&
    preparedStructureReady &&
    preparedCupReady &&
    config.preparedPublished === true &&
    config.historyCleanupPending !== true &&
    retainedArchiveMatchesPolicy;
  const transitionStatus = activeSeason > 1
    ? (config.historyCleanupPending === true ? 'ACTIVATED_CLEANUP_PENDING' : 'SUCCESSOR_ACTIVE')
    : (!nextSeasonDue && !transitionRequested
      ? 'SEASON_ACTIVE'
      : transitionPrerequisitesReady
        ? (preparedSeasonStart && Date.now() >= preparedSeasonStart.getTime() ? 'ACTIVATION_DUE' : 'S2_PUBLISHED_WAITING_ACTIVATION')
        : 'TRANSITION_BLOCKED_OR_INCOMPLETE');

  return {
    activeSeason,
    phase,
    worldReady: config.worldReady === true,
    seasonStart: toDate(config.seasonStart)?.toISOString() || null,
    nextSeasonStart: nextSeasonStart?.toISOString() || null,
    nextSeasonDue,
    transitionRequested,
    transitionStatus,
    transitionPrerequisitesReady,
    league: {
      tables: tablesSnap.size,
      slots: slotsSnap.size,
      fixtures: leagueMatches.length,
      finishedMatches,
      unresolvedMatches,
      structureReady: tablesSnap.size === 15 &&
        slotsSnap.size === 120 &&
        leagueMatches.length === 840 &&
        rolloverPreflight?.structureReady === true,
      rolloverPreflight,
    },
    archive,
    archiveHistoryStatus: archiveHistorySnap.exists
      ? String((archiveHistorySnap.data() || {}).status || '')
      : null,
    archiveRetention: {
      count: archiveSeasons.length,
      retainedSeason: archiveSeasons.length === 1 ? archiveSeasons[0] : null,
      expectedSeason: expectedRetainedArchive,
      sourceArchivePresent,
      matchesPolicy: retainedArchiveMatchesPolicy,
    },
    nextRollover: {
      targetSeason: activeSeason + 1,
      exists: Boolean(plan),
      ready: rolloverPlanReady,
      valid: planValidation.valid,
      mode: plan?.mode || null,
      awardsReady: plan?.awards?.ready === true,
      groups: plan?.groups && typeof plan.groups === 'object'
        ? Object.keys(plan.groups).length
        : 0,
    },
    preparedSeason: {
      seasonNumber: preparedSeasonNumber || null,
      worldReady: config.preparedWorldReady === true,
      published: config.preparedPublished === true,
      tables: preparedTablesSnap.size,
      slots: preparedSlotsSnap.size,
      fixtures: preparedMatchesSnap.size,
      structureReady: preparedStructureReady,
      pyramidCupReady: preparedCupReady,
      pyramidCupSnapshots: preparedCupSnapshots.size,
      pyramidCupMatches: preparedCupMatches.size,
      seasonStart: preparedSeasonStart?.toISOString() || null,
      nextSeasonStart: preparedNextSeasonStart?.toISOString() || null,
    },
    historyCleanupPending: config.historyCleanupPending === true,
    resetInProgress: config.stagingSeasonOneResetInProgress === true,
  };
}

/**
 * Read-only, staging-only Pyramid Cup inspection.
 * Returns aggregate counts and format metadata only; no team names, UIDs,
 * rosters, tactics, match reports, or player financial data are exposed.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return respond(401, { success: false, error: 'UNAUTHORIZED', readOnly: true });
  }

  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';
  if (configuredProject !== EXPECTED_PROJECT) {
    return respond(403, {
      success: false,
      readOnly: true,
      error: 'STAGING_PROJECT_MISMATCH',
    });
  }

  try {
    const db = getAdminDb();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    const config = configSnap.exists ? configSnap.data() || {} : {};
    const activeSeason = Number(config.activeSeasonNumber || 0);
    const cupRef = db.collection(CUP_COLLECTION).doc(CUP_ID);
    const [
      cupSnap,
      dedicatedMatches,
      legacyMatches,
      snapshotDocs,
      seasonDiagnostics,
    ] = await Promise.all([
      cupRef.get(),
      db.collection('cup_matches').where('cupId', '==', CUP_ID).get(),
      db.collection('matches_v2').where('cupId', '==', CUP_ID).get(),
      db.collection(SNAPSHOT_COLLECTION).doc(CUP_ID).collection('teams').get(),
      readSeasonDiagnostics(db, config),
    ]);

    const seasonStart = toDate(config.seasonStart);
    const now = new Date();
    const seasonDay = seasonStart
      ? Math.floor((now.getTime() - seasonStart.getTime()) / 86400000) + 1
      : null;
    const cup = cupSnap.exists ? cupSnap.data() || {} : null;
    const rounds = cup && cup.rounds && typeof cup.rounds === 'object' ? cup.rounds : {};
    const allFixtureDocs = [...dedicatedMatches.docs, ...legacyMatches.docs];
    const fixtureById: Record<string, any> = Object.create(null);
    for (const doc of allFixtureDocs) {
      if (!Object.prototype.hasOwnProperty.call(fixtureById, doc.id)) {
        fixtureById[doc.id] = doc.data() || {};
      }
    }

    const expectedPairings = [56, 32, 16, 8, 4, 2, 1];
    const expectedParticipants = [112, 64, 32, 16, 8, 4, 2];
    const currentRound = Number(cup?.currentRound || 0);
    const roundSummary = expectedPairings.map((expectedFixtures, index) => {
      const roundNumber = index + 1;
      const key = 'r' + roundNumber;
      const pairings = Array.isArray(rounds[key]) ? rounds[key] : [];
      const participantIds = new Set<string>();
      let byes = 0;
      let finished = 0;
      let fixtureDocuments = 0;
      let fixtureIntegrity = true;
      for (const pairing of pairings) {
        if (pairing?.home?.id) participantIds.add(String(pairing.home.id));
        if (pairing?.away?.id) participantIds.add(String(pairing.away.id));
        if (!pairing?.home?.id || !pairing?.away?.id) byes++;
        if (pairing?.status === 'finished') finished++;
        if (roundNumber <= currentRound) {
          const matchId = String(pairing?.matchId || '');
          const fixture = fixtureById[matchId];
          const expectedBestOf = roundNumber === 7 ? 3 : 1;
          if (fixture) fixtureDocuments++;
          if (!fixture ||
              String(fixture.cupId || '') !== CUP_ID ||
              String(fixture.homeId || '') !== String(pairing?.home?.id || '') ||
              String(fixture.awayId || '') !== String(pairing?.away?.id || '') ||
              Number(fixture.bestOf) !== expectedBestOf) {
            fixtureIntegrity = false;
          }
          if (pairing?.status === 'finished' && !isTerminalMatch(fixture || {})) {
            fixtureIntegrity = false;
          }
        }
      }
      return {
        round: key,
        fixtures: pairings.length,
        expectedFixtures,
        participants: participantIds.size,
        expectedParticipants: expectedParticipants[index],
        byes,
        finished,
        fixtureDocuments,
        fixtureIntegrity,
        complete: pairings.length === expectedFixtures &&
          participantIds.size === expectedParticipants[index] &&
          byes === 0 &&
          (roundNumber > currentRound || fixtureIntegrity),
      };
    });

    const participants = Array.isArray(cup?.participants) ? cup!.participants.length : 0;
    const roundOne = roundSummary[0];
    const noByes = roundSummary.every(round => round.byes === 0);
    const completedRoundShape = roundSummary.every((round, index) =>
      index + 1 <= currentRound ? round.complete : round.fixtures === 0
    );
    const validCupStatus = cup?.status === 'active' || cup?.status === 'completed';
    const cupStructureReady = Boolean(
      cup &&
      Number(cup.season) === 1 &&
      validCupStatus &&
      currentRound >= 1 && currentRound <= 7 &&
      Number(cup.formatVersion) === 4 &&
      cup.format === 'D1_REST_OPENING_ROUND' &&
      Number(cup.totalParticipants) === EXPECTED_CUP_PARTICIPANTS &&
      participants === EXPECTED_CUP_PARTICIPANTS &&
      Number(cup.totalMatches) === EXPECTED_CUP_MATCHES &&
      Number(cup.preliminaryMatches) === 56 &&
      Array.isArray(cup.openingRoundRestTeams) &&
      cup.openingRoundRestTeams.length === 8 &&
      cup.openingRoundRestTeams.every((team: any) => Number(team?.level) === 1) &&
      new Set(cup.openingRoundRestTeams.map((team: any) => String(team?.id || ''))).size === 8 &&
      new Set((cup.participants || []).map((team: any) => String(team?.id || ''))).size === 120 &&
      snapshotDocs.size === EXPECTED_CUP_PARTICIPANTS &&
      roundOne.complete &&
      completedRoundShape &&
      noByes &&
      (cup.status !== 'completed' || (currentRound === 7 && roundSummary.every(round => round.finished === round.expectedFixtures)))
    );
    const cupMustBeCompleted = activeSeason > 1;
    const cupLifecycleValid = cupStructureReady &&
      (!cupMustBeCompleted || cup?.status === 'completed');

    return respond(200, {
      success: true,
      readOnly: true,
      projectId: EXPECTED_PROJECT,
      activeSeason,
      phase: config.phase || null,
      seasonStart: seasonStart?.toISOString() || null,
      nextSeasonStart: toDate(config.nextSeasonStart)?.toISOString() || null,
      seasonDay,
      cupExists: Boolean(cup),
      cupId: CUP_ID,
      cup: cup ? {
        status: cup.status || null,
        format: cup.format || null,
        formatVersion: Number(cup.formatVersion || 0),
        currentRound,
        participants,
        totalParticipants: Number(cup.totalParticipants || 0),
        preliminaryMatches: Number(cup.preliminaryMatches || 0),
        totalMatches: Number(cup.totalMatches || 0),
        openingRoundRestTeams: Array.isArray(cup.openingRoundRestTeams)
          ? cup.openingRoundRestTeams.length
          : 0,
        rounds: roundSummary,
      } : null,
      cupIntegrity: {
        ready: cupLifecycleValid,
        structureReady: cupStructureReady,
        lifecycleValid: cupLifecycleValid,
        mustBeCompleted: cupMustBeCompleted,
        noByes,
        openingRoundParticipants: roundOne?.participants || 0,
        participantSnapshots: snapshotDocs.size,
        completedRounds: roundSummary.filter(round => round.complete && round.finished === round.expectedFixtures).length,
      },
      season: seasonDiagnostics,
      participantSnapshots: snapshotDocs.size,
      dedicatedMatches: dedicatedMatches.size,
      legacyMatches: legacyMatches.size,
    });
  } catch (error) {
    console.error('[STAGING CUP DIAGNOSTICS] Failed:', error);
    return respond(503, {
      success: false,
      error: 'STAGING_CUP_DIAGNOSTICS_UNAVAILABLE',
      readOnly: true,
    });
  }
}
