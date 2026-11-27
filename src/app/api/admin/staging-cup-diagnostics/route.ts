import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';
import { isValidCleanSeasonOneBoundary } from '@/app/actions/season-boundary';
import { diagnoseSeasonRolloverPreflight } from '@/app/actions/season-rollover';
import { validateRolloverPlan } from '@/app/actions/season-rollover-plan';
import { isRolloverPlanPublicationReady } from '@/app/actions/season-awards-policy';
import { validateSeasonArchiveRolloverPlan, validateSeasonArchiveSnapshot } from '@/app/actions/season-archive';
import {
  isCanonicalCupParticipantField,
  isCanonicalPyramidCupOpeningField,
  isPyramidCupRoundProgressionValid,
  isValidCupParticipantMatchSnapshot,
  isCupParticipantMatchSnapshotCompatible,
} from '@/app/lib/cup-participant-integrity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

/**
 * Inspect the Cup belonging to the currently active season. Season 1 has a
 * dedicated launch gate below; once S2 is active this check keeps each later
 * season's Cup under the same no-BYE, fixture and frozen-roster invariants.
 */
async function readActiveSeasonCupIntegrity(db: any, season: number) {
  const cupId = 'cup_s' + season + '_l' + LEAGUE_ID;
  const [
    cupSnap,
    snapshotsSnap,
    dedicatedMatchesSnap,
    legacyMatchesSnap,
  ] = await Promise.all([
    db.collection(CUP_COLLECTION).doc(cupId).get(),
    db.collection(SNAPSHOT_COLLECTION).doc(cupId).collection('teams').get(),
    db.collection('cup_matches').where('cupId', '==', cupId).get(),
    db.collection('matches_v2').where('cupId', '==', cupId).get(),
  ]);

  const cup = cupSnap.exists ? cupSnap.data() || {} : null;
  const rounds = cup && cup.rounds && typeof cup.rounds === 'object' ? cup.rounds : {};
  const participants = Array.isArray(cup?.participants) ? cup.participants : [];
  const participantSlotsValid = isCanonicalCupParticipantField(participants);
  const participantIds = new Set<string>();
  const participantById: Record<string, any> = {};
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let participantShapeValid = participants.length === EXPECTED_CUP_PARTICIPANTS;

  for (const team of participants) {
    const id = String(team?.id || '');
    const level = Number(team?.level);
    const group = Number(team?.group);
    const rank = Number(team?.rank);
    const seed = Number(team?.seed);
    if (!id || Object.prototype.hasOwnProperty.call(participantById, id) ||
        !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > Math.pow(2, level - 1) ||
        !Number.isInteger(rank) || rank < 1 || rank > 8 ||
        !Number.isInteger(seed) || seed < 1 || seed > EXPECTED_CUP_PARTICIPANTS) {
      participantShapeValid = false;
      continue;
    }
    participantIds.add(id);
    participantById[id] = { level, group, rank, seed };
    levelCounts[level as 1 | 2 | 3 | 4] += 1;
  }

  const levelDistributionValid = levelCounts[1] === 8 &&
    levelCounts[2] === 16 &&
    levelCounts[3] === 32 &&
    levelCounts[4] === 64;

  const restTeams = Array.isArray(cup?.openingRoundRestTeams) ? cup.openingRoundRestTeams : [];
  const openingFieldValid = isCanonicalPyramidCupOpeningField(participants, rounds.r1, restTeams);
  const restIds = new Set<string>();
  let restFieldValid = restTeams.length === 8;
  for (const team of restTeams) {
    const id = String(team?.id || '');
    if (!id || restIds.has(id) || Number(team?.level) !== 1 ||
        !participantIds.has(id) || participantById[id]?.level !== 1) {
      restFieldValid = false;
      continue;
    }
    restIds.add(id);
  }
  if (restIds.size !== 8 ||
      [...participantIds].filter(id => participantById[id]?.level === 1).some(id => !restIds.has(id))) {
    restFieldValid = false;
  }

  const snapshotIds = new Set<string>();
  const participantSnapshotById = new Map<string, any>();
  let snapshotsValid = snapshotsSnap.size === EXPECTED_CUP_PARTICIPANTS;
  for (const doc of snapshotsSnap.docs || []) {
    const id = String(doc.id);
    const data = doc.data() || {};
    snapshotIds.add(id);
    participantSnapshotById.set(id, data.matchSnapshot);
    if (!participantIds.has(id) ||
        data.cupId !== cupId ||
        data.teamId !== id ||
        Number(data.season) !== season ||
        !isValidCupParticipantMatchSnapshot(data.matchSnapshot, id)) {
      snapshotsValid = false;
    }
  }
  if (snapshotIds.size !== EXPECTED_CUP_PARTICIPANTS ||
      [...participantIds].some(id => !snapshotIds.has(id))) {
    snapshotsValid = false;
  }

  const fixtureById: Record<string, any> = {};
  const allFixtureDocs = [...(dedicatedMatchesSnap.docs || []), ...(legacyMatchesSnap.docs || [])];
  for (const doc of allFixtureDocs) {
    if (!Object.prototype.hasOwnProperty.call(fixtureById, doc.id)) {
      fixtureById[doc.id] = doc.data() || {};
    }
  }
  const fixtureCount = Object.keys(fixtureById).length;
  const currentRound = Number(cup?.currentRound || 0);
  const progressionValid = isPyramidCupRoundProgressionValid(rounds, currentRound, restTeams);
  const expectedPairings = [56, 32, 16, 8, 4, 2, 1];
  const expectedParticipants = [112, 64, 32, 16, 8, 4, 2];
  let roundsValid = Number.isInteger(currentRound) && currentRound >= 1 && currentRound <= 7;
  let finishedMatches = 0;
  let activeFixtures = 0;
  let expectedFixtureDocuments = 0;
  const roundSummaries = [];

  for (let round = 1; round <= 7; round += 1) {
    const pairings = Array.isArray(rounds['r' + round]) ? rounds['r' + round] : [];
    const participantsInRound = new Set<string>();
    const roundFixtureIds = new Set<string>();
    let roundFinished = 0;
    let roundFixtureIntegrity = true;

    if (round <= currentRound) {
      expectedFixtureDocuments += expectedPairings[round - 1];
      if (pairings.length !== expectedPairings[round - 1]) roundFixtureIntegrity = false;
    } else if (pairings.length !== 0) {
      roundFixtureIntegrity = false;
    }

    for (let index = 0; index < pairings.length; index += 1) {
      const pairing = pairings[index];
      const pairingIndex = index + 1;
      const homeId = String(pairing?.home?.id || '');
      const awayId = String(pairing?.away?.id || '');
      const matchId = 'cup_S' + season + '_R' + round + '_M' + String(pairingIndex).padStart(2, '0');
      const fixture = fixtureById[matchId];
      const expectedBestOf = round === 7 ? 3 : 1;
      const isFinished = String(pairing?.status || '').toLowerCase() === 'finished';

      if (pairing?.id !== 'r' + round + '_m' + pairingIndex ||
          Number(pairing?.index) !== pairingIndex ||
          pairing?.matchId !== matchId ||
          !homeId || !awayId || homeId === awayId ||
          !participantIds.has(homeId) || !participantIds.has(awayId) ||
          participantsInRound.has(homeId) || participantsInRound.has(awayId) ||
          !['scheduled', 'finished'].includes(String(pairing?.status || '').toLowerCase())) {
        roundFixtureIntegrity = false;
      }

      if (homeId) participantsInRound.add(homeId);
      if (awayId) participantsInRound.add(awayId);
      if (isFinished) {
        roundFinished++;
        finishedMatches++;
      } else if (round <= currentRound) {
        activeFixtures++;
      }

      if (round <= currentRound) {
        roundFixtureIds.add(matchId);
        const fixtureFinished = isTerminalMatch(fixture || {});
        if (!fixture ||
            String(fixture.id || matchId) !== matchId ||
            String(fixture.cupId || '') !== cupId ||
            Number(fixture.season) !== season ||
            Number(fixture.cupRound) !== round ||
            Number(fixture.bestOf) !== expectedBestOf ||
            String(fixture.homeId || '') !== homeId ||
            String(fixture.awayId || '') !== awayId ||
            !isCupParticipantMatchSnapshotCompatible(fixture.homeTeamSnapshot, participantSnapshotById.get(homeId), homeId) ||
            !isCupParticipantMatchSnapshotCompatible(fixture.awayTeamSnapshot, participantSnapshotById.get(awayId), awayId) ||
            isFinished !== fixtureFinished ||
            (isFinished && (!fixtureFinished ||
              ![homeId, awayId].includes(String(pairing.winnerId || '')) ||
              String(fixture.winnerId || '') !== String(pairing.winnerId || '')))) {
          roundFixtureIntegrity = false;
        }
      }
    }

    if (round <= currentRound &&
        (participantsInRound.size !== expectedParticipants[round - 1] ||
         roundFixtureIds.size !== expectedPairings[round - 1])) {
      roundFixtureIntegrity = false;
    }
    if (round < currentRound && roundFinished !== expectedPairings[round - 1]) {
      roundFixtureIntegrity = false;
    }

    roundsValid = roundsValid && roundFixtureIntegrity;
    roundSummaries.push({
      round,
      fixtures: pairings.length,
      expectedFixtures: expectedPairings[round - 1],
      participants: participantsInRound.size,
      expectedParticipants: expectedParticipants[round - 1],
      finished: roundFinished,
      fixtureIntegrity: roundFixtureIntegrity,
    });
  }

  const completed = String(cup?.status || '').toLowerCase() === 'completed';
  const active = String(cup?.status || '').toLowerCase() === 'active';
  const finalPairing = Array.isArray(rounds.r7) ? rounds.r7[0] : null;
  const expectedCompletedFixtures = expectedPairings.reduce((sum, count) => sum + count, 0);
  const lifecycleValid = Boolean(cup &&
    (active || completed) &&
    (!completed || (currentRound === 7 &&
      finishedMatches === expectedCompletedFixtures &&
      Boolean(cup.winnerId) &&
      participantIds.has(String(cup.winnerId)) &&
      String(finalPairing?.winnerId || '') === String(cup.winnerId))) &&
    (active || completed));
  const fixtureCountValid = fixtureCount === expectedFixtureDocuments;
  const ready = Boolean(
    cup &&
    Number(cup.season) === season &&
    String(cup.leagueId || '') === LEAGUE_ID &&
    Number(cup.formatVersion) === 4 &&
    cup.format === 'D1_REST_OPENING_ROUND' &&
    Number(cup.totalParticipants) === EXPECTED_CUP_PARTICIPANTS &&
    participants.length === EXPECTED_CUP_PARTICIPANTS &&
    Number(cup.totalMatches) === EXPECTED_CUP_MATCHES &&
    Number(cup.preliminaryMatches) === 56 &&
    Number(cup.totalRounds) === 7 &&
    Number(cup.openingRoundRestCount) === 8 &&
    Number(cup.byeCount) === 0 &&
    participantShapeValid &&
    participantSlotsValid &&
    participantIds.size === EXPECTED_CUP_PARTICIPANTS &&
    levelDistributionValid &&
    restFieldValid &&
    openingFieldValid &&
    progressionValid &&
    snapshotsValid &&
    lifecycleValid &&
    roundsValid &&
    fixtureCountValid
  );

  return {
    required: true,
    season,
    cupId,
    exists: Boolean(cupSnap.exists),
    status: cup?.status || null,
    currentRound: currentRound || null,
    participants: participants.length,
    participantDistribution: levelCounts,
    participantSlotsValid,
    openingFieldValid,
    progressionValid,
    snapshots: snapshotsSnap.size,
    snapshotsValid,
    fixtures: fixtureCount,
    expectedFixtureDocuments,
    finishedMatches,
    activeFixtures,
    rounds: roundSummaries,
    lifecycleValid,
    ready,
  };
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
  const seasonStart = toDate(config.seasonStart);
  const nextSeasonStart = toDate(config.nextSeasonStart);
  const seasonTimelineValid = Boolean(
    seasonStart &&
    nextSeasonStart &&
    nextSeasonStart.getTime() > seasonStart.getTime() &&
    (activeSeason !== 1 || config.worldGeneration !== 'CLEAN_S1_V1' ||
      isValidCleanSeasonOneBoundary(config.worldGeneration, activeSeason, config.seasonStart, config.nextSeasonStart)) &&
    (activeSeason === 1 || nextSeasonStart.getTime() - seasonStart.getTime() === 15 * 24 * 60 * 60 * 1000)
  );
  const activeCupIntegrity = activeSeason > 1
    ? await readActiveSeasonCupIntegrity(db, activeSeason)
    : { required: false, season: activeSeason, ready: true, reason: 'VALIDATED_BY_SEASON_ONE_GATE' };
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

  let retainedArchiveIntegrity: any = { required: activeSeason > 1, valid: activeSeason === 1 };
  if (activeSeason > 1) {
    const [retainedArchiveSnap, retainedArchivePlanSnap] = await Promise.all([
      db.collection('league_season_archives_v1').doc('S' + (activeSeason - 1)).get(),
      db.collection('league_season_rollovers_v1').doc('S' + activeSeason).get(),
    ]);
    if (retainedArchiveSnap.exists && retainedArchivePlanSnap.exists) {
      const retainedMatchesSnap = await retainedArchiveSnap.ref.collection('matches').get();
      const retainedArchiveData = retainedArchiveSnap.data() || {};
      const retainedPlan = retainedArchivePlanSnap.data() || {};
      const retainedMatches = retainedMatchesSnap.docs.map((doc: any) => ({
        ...doc.data(),
        matchId: doc.id,
      }));
      const retainedSnapshotValidation = validateSeasonArchiveSnapshot(retainedArchiveData, retainedMatches);
      const retainedPlanValidation = validateSeasonArchiveRolloverPlan(retainedArchiveData, retainedPlan);
      retainedArchiveIntegrity = {
        required: true,
        exists: true,
        sourceSeason: Number(retainedArchiveData.sourceSeason || 0),
        matches: retainedMatchesSnap.size,
        snapshotValid: retainedSnapshotValidation.valid,
        rolloverPlanValid: retainedPlanValidation.valid,
        valid: retainedSnapshotValidation.valid && retainedPlanValidation.valid &&
          validateRolloverPlan(retainedPlan, activeSeason - 1, activeSeason).valid &&
          retainedPlan.mode !== 'recovery_carry_forward' &&
          isRolloverPlanPublicationReady(retainedPlan),
        reasonCodes: safeReasonCodes(retainedSnapshotValidation.reasons),
        rolloverReason: retainedPlanValidation.valid ? null : String(retainedPlanValidation.reason || 'RETAINED_ARCHIVE_ROLLOVER_INVALID'),
      };
    } else {
      retainedArchiveIntegrity = {
        required: true,
        exists: retainedArchiveSnap.exists,
        valid: false,
        reason: retainedArchiveSnap.exists ? 'RETAINED_ARCHIVE_ROLLOVER_MISSING' : 'RETAINED_ARCHIVE_MISSING',
      };
    }
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
    ? archiveSeasons.length === 0
    : archiveSeasons.length === 1 &&
      archiveSeasons[0] === expectedRetainedArchive &&
      retainedArchiveIntegrity.valid === true;

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
  const preparedCupFixtureById: Record<string, any> = {};
  for (const doc of preparedCupMatches.docs || []) {
    if (!Object.prototype.hasOwnProperty.call(preparedCupFixtureById, doc.id)) {
      preparedCupFixtureById[doc.id] = doc.data() || {};
    }
  }
  const preparedCupParticipantIds = new Set<string>(
    (Array.isArray(preparedCup?.participants) ? preparedCup.participants : [])
      .map((team: any) => String(team?.id || ''))
      .filter(Boolean)
  );
  const preparedCupOpeningIds = new Set<string>();
  const preparedCupRestTeams = Array.isArray(preparedCup?.openingRoundRestTeams)
    ? preparedCup.openingRoundRestTeams
    : [];
  const preparedCupRestIds = new Set<string>(preparedCupRestTeams.map((team: any) => String(team?.id || '')).filter(Boolean));
  const preparedCupPairingsValid = preparedCupRounds.length === 56 && preparedCupRounds.every((pairing: any) => {
    const homeId = String(pairing?.home?.id || '');
    const awayId = String(pairing?.away?.id || '');
    const pairingIndex = Number(pairing?.index || 0);
    const expectedMatchId = 'cup_S' + preparedSeasonNumber + '_R1_M' + String(pairingIndex).padStart(2, '0');
    const fixture = preparedCupFixtureById[String(pairing?.matchId || '')];
    if (!homeId || !awayId || homeId === awayId ||
        pairing?.matchId !== expectedMatchId ||
        Number(pairing?.home?.level) === 1 ||
        Number(pairing?.away?.level) === 1 ||
        !preparedCupParticipantIds.has(homeId) ||
        !preparedCupParticipantIds.has(awayId) ||
        !fixture ||
        String(fixture.cupId || '') !== preparedCupId ||
        Number(fixture.cupRound) !== 1 ||
        Number(fixture.bestOf) !== 1 ||
        String(fixture.homeId || '') !== homeId ||
        String(fixture.awayId || '') !== awayId) {
      return false;
    }
    preparedCupOpeningIds.add(homeId);
    preparedCupOpeningIds.add(awayId);
    return true;
  });
  const preparedCupOpeningFieldValid = preparedCupOpeningIds.size === 112 &&
    preparedCupRestIds.size === 8 &&
    preparedCupRestTeams.every((team: any) =>
      Number(team?.level) === 1 &&
      preparedCupParticipantIds.has(String(team?.id || '')) &&
      !preparedCupOpeningIds.has(String(team?.id || ''))
    ) &&
    preparedCupParticipantIds.size === 120 &&
    [...preparedCupParticipantIds].every(id =>
      preparedCupOpeningIds.has(id) || preparedCupRestIds.has(id)
    );
  const preparedCupFixtureIntegrity = preparedCupMatches.size === 56 &&
    preparedCupPairingsValid &&
    preparedCupOpeningFieldValid;
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
    preparedCupFixtureIntegrity
  );

  const transitionPrerequisitesReady = seasonTimelineValid && activeCupIntegrity.ready === true && unresolvedMatches === 0 &&
    archive.ready === true &&
    rolloverPlanReady &&
    preparedStructureReady &&
    preparedCupReady &&
    config.preparedPublished === true &&
    config.historyCleanupPending !== true &&
    retainedArchiveMatchesPolicy;
  const transitionStatus = activeSeason > 1
    ? (config.historyCleanupPending === true ? 'ACTIVATED_CLEANUP_PENDING' : 'SUCCESSOR_ACTIVE')
    : (!seasonTimelineValid
      ? 'SEASON_TIMELINE_INVALID'
      : (!nextSeasonDue && !transitionRequested
        ? 'SEASON_ACTIVE'
      : transitionPrerequisitesReady
        ? (preparedSeasonStart && Date.now() >= preparedSeasonStart.getTime() ? 'ACTIVATION_DUE' : 'S2_PUBLISHED_WAITING_ACTIVATION')
        : 'TRANSITION_BLOCKED_OR_INCOMPLETE'));

  return {
    activeSeason,
    phase,
    worldReady: config.worldReady === true,
    seasonStart: toDate(config.seasonStart)?.toISOString() || null,
    nextSeasonStart: nextSeasonStart?.toISOString() || null,
    nextSeasonDue,
    seasonTimelineValid,
    transitionRequested,
    transitionStatus,
    transitionPrerequisitesReady,
    activeCup: activeCupIntegrity,
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
      retainedArchiveIntegrity,
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
      preparedCupFixtureIntegrity,
      seasonStart: preparedSeasonStart?.toISOString() || null,
      nextSeasonStart: preparedNextSeasonStart?.toISOString() || null,
    },
    historyCleanupPending: config.historyCleanupPending === true,
    resetInProgress: config.stagingSeasonOneResetInProgress === true || config.stagingFreshSeasonOneReset === true,
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
    const fixtureById: Record<string, any> = {};
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
          const expectedPairingId = 'r' + roundNumber + '_m' + String(pairing?.index || 0);
          const expectedMatchId = 'cup_S1_R' + roundNumber + '_M' + String(pairing?.index || 0).padStart(2, '0');
          if (pairing?.id !== expectedPairingId ||
              pairing?.matchId !== expectedMatchId ||
              Number(fixture?.season) !== 1 ||
              Number(fixture?.cupRound) !== roundNumber ||
              !Array.isArray(fixture?.homeTeamSnapshot?.players) ||
              fixture.homeTeamSnapshot.players.length !== 5 ||
              !Array.isArray(fixture?.awayTeamSnapshot?.players) ||
              fixture.awayTeamSnapshot.players.length !== 5) {
            fixtureIntegrity = false;
          }
          if (pairing?.status === 'finished' &&
              (!isTerminalMatch(fixture || {}) ||
               ![pairing?.home?.id, pairing?.away?.id].includes(String(fixture?.winnerId || '')))) {
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
    const cupParticipantIds = new Set<string>(
      (Array.isArray(cup?.participants) ? cup!.participants : [])
        .map((team: any) => String(team?.id || ''))
        .filter(Boolean)
    );
    const cupOpeningPairings = Array.isArray(rounds.r1) ? rounds.r1 : [];
    const cupOpeningIds = new Set<string>();
    for (const pairing of cupOpeningPairings) {
      if (pairing?.home?.id) cupOpeningIds.add(String(pairing.home.id));
      if (pairing?.away?.id) cupOpeningIds.add(String(pairing.away.id));
    }
    const cupRestTeams = Array.isArray(cup?.openingRoundRestTeams) ? cup!.openingRoundRestTeams : [];
    const cupRestIds = new Set<string>(cupRestTeams.map((team: any) => String(team?.id || '')).filter(Boolean));
    const cupParticipantSlotsValid = isCanonicalCupParticipantField(Array.isArray(cup?.participants) ? cup!.participants : []);
    const cupOpeningFieldValid = cupParticipantSlotsValid &&
      isCanonicalPyramidCupOpeningField(cup?.participants, cupOpeningPairings, cupRestTeams) &&
      cupParticipantIds.size === EXPECTED_CUP_PARTICIPANTS &&
      cupOpeningIds.size === 112 &&
      cupRestIds.size === 8 &&
      cupRestTeams.every((team: any) =>
        Number(team?.level) === 1 &&
        cupParticipantIds.has(String(team?.id || '')) &&
        !cupOpeningIds.has(String(team?.id || ''))
      ) &&
      [...cupParticipantIds].every(id => cupOpeningIds.has(id) || cupRestIds.has(id)) &&
      [...cupOpeningIds].every(id => cupParticipantIds.has(id));
    const cupSnapshotIds = new Set<string>((snapshotDocs.docs || []).map((doc: any) => String(doc.id)));
    const cupSnapshotsValid = snapshotDocs.size === EXPECTED_CUP_PARTICIPANTS &&
      cupSnapshotIds.size === EXPECTED_CUP_PARTICIPANTS &&
      [...cupParticipantIds].every(id => cupSnapshotIds.has(id)) &&
      (snapshotDocs.docs || []).every((doc: any) =>
        Array.isArray(doc.data()?.matchSnapshot?.players) &&
        doc.data().matchSnapshot.players.length === 5
      );
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
      cupOpeningFieldValid &&
      cupSnapshotsValid &&
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
        openingFieldValid: cupOpeningFieldValid,
        participantSlotsValid: cupParticipantSlotsValid,
        participantSnapshots: snapshotDocs.size,
        snapshotsValid: cupSnapshotsValid,
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
