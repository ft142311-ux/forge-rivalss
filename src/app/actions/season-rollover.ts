import { FieldValue } from 'firebase-admin/firestore';
import { getTableId, MAX_LEVELS, TEAMS_PER_GROUP, TOTAL_GROUPS } from '@/app/lib/leagues-data';
import { buildCanonicalSlotRepairs, calculateGroupStandings, evaluateRolloverPreflight, hasCanonicalFixtureStructure, hasCompleteCanonicalFixtureSet, inspectGroupReconciliation } from './season-rollover-standings';
import { acquireSeasonRolloverLock, commitSeasonRolloverWrites, releaseSeasonRolloverLock, SEASON_ROLLOVER_LOCK_TTL_MS } from './season-rollover-lock';
import { buildPromotionRelegationGroups, validateRolloverPlan } from './season-rollover-plan';
import { isSeasonArchiveReadyToComplete, validateSeasonArchiveSnapshot } from './season-archive';
import { runTwoPhaseSeasonOrchestration } from './season-orchestration';
import { isValidCleanSeasonOneBoundary } from './season-boundary';
import { resolveSeasonAwardRecipientState, shouldPersistSeasonTrophies } from './season-awards-policy';

const LEAGUE_ID = 'ALPHA';
const EXPECTED_MATCHES = TOTAL_GROUPS * TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1);

// Canonical boundary for the one-time Season 1 -> Season 2 recovery. Keep this
// guard scoped to that transition; later seasons continue to use their config.
const SEASON_2_SCHEDULED_START = '2026-10-08T15:00:00.000Z';

async function checkSeason1To2Boundary(db: any, sourceSeason: number, targetSeason: number) {
  if (sourceSeason !== 1 || targetSeason !== 2) return { ready: true };
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  if (!configSnap.exists) {
    return { ready: false, reason: 'SEASON_CONFIG_MISSING', sourceSeason, targetSeason, writesStarted: false };
  }
  const config = configSnap.data() || {};
  const activeSeason = Number(config.activeSeasonNumber || 1);
  const scheduledStartMs = config.nextSeasonStart ? new Date(config.nextSeasonStart).getTime() : NaN;
  const cleanGeneratedBoundary = isValidCleanSeasonOneBoundary(
    config.worldGeneration,
    activeSeason,
    config.seasonStart,
    config.nextSeasonStart,
  );
  const expectedStartMs = cleanGeneratedBoundary
    ? scheduledStartMs
    : new Date(SEASON_2_SCHEDULED_START).getTime();
  const configuredNext = [config.nextSeasonNumber, config.preparationTargetSeason]
    .map((value: any) => Number(value))
    .filter((value: number) => Number.isSafeInteger(value) && value > 0);
  if (activeSeason !== 1) {
    return { ready: false, reason: 'ACTIVE_SEASON_CHANGED', sourceSeason: activeSeason, targetSeason, writesStarted: false };
  }
  if (!Number.isFinite(scheduledStartMs) || scheduledStartMs !== expectedStartMs) {
    return { ready: false, reason: 'SEASON_2_BOUNDARY_MISMATCH', sourceSeason, targetSeason, expectedStart: SEASON_2_SCHEDULED_START, configuredStart: config.nextSeasonStart || null, writesStarted: false };
  }
  if (configuredNext.some((season: number) => season !== 2)) {
    return { ready: false, reason: 'TARGET_SEASON_CONFLICT', sourceSeason, targetSeason, configuredNext, writesStarted: false };
  }
  if (config.worldReady !== true) {
    return { ready: false, reason: 'SEASON_1_WORLD_NOT_READY', sourceSeason, targetSeason, writesStarted: false };
  }
  return { ready: true, sourceSeason, targetSeason, scheduledStart: SEASON_2_SCHEDULED_START };
}

type TeamRow = Record<string, any>;
function groupKey(level: number, group: number) { return `D${level}-G${group}`; }
/**
 * One-time Season 1 recovery gate. It may ignore stale standings projections and
 * repairable slot assignments only when the full canonical fixture shape and a
 * complete, uniquely ranked slot set make the repair deterministic. The actual
 * writes happen later, under the rollover lock. Seasons 2 onward stay strict.
 */
function inspectRolloverGroup(
  sourceSeason: number,
  allowTestSeasonRecovery: boolean,
  stats: any,
  fixtures: any[],
  slots: any[],
  expectedTeams = TEAMS_PER_GROUP,
) {
  const inspection = inspectGroupReconciliation(stats, fixtures, slots, expectedTeams);
  if (!allowTestSeasonRecovery || sourceSeason !== 1) return inspection;
  const repairs = buildCanonicalSlotRepairs(fixtures, slots, expectedTeams);
  if (!inspection.fixtureStructureComplete || !repairs) return inspection;
  const recoveryRequired = inspection.reasons.length > 0 || inspection.staleRows.length > 0 || inspection.slotConflicts.length > 0;
  return {
    ...inspection,
    ready: true,
    reasons: [],
    staleRows: [],
    slotConflicts: [],
    recoveryRequired,
    recoveryReasons: inspection.reasons,
    recoveryStaleRows: inspection.staleRows,
    recoverySlotConflicts: inspection.slotConflicts,
  };
}
function scoreOf(m: any) {
  const home = Number(m?.seriesScore?.home ?? m?.scoreA);
  const away = Number(m?.seriesScore?.away ?? m?.scoreB);
  if (![home, away].every(Number.isInteger) || home < 0 || home > 2 || away < 0 || away > 2 || (home === 0 && away === 0)) return null;
  return { home, away };
}
// End-of-season prize pool in credits. Every division pays less than the one above it;
// within a division, the payout decreases with final placement.
const DIVISION_PRIZES: Record<number, number[]> = {
  1: [4_000_000, 3_600_000, 3_200_000, 2_800_000, 2_600_000, 2_400_000, 2_200_000, 2_000_000],
  2: [1_800_000, 1_650_000, 1_500_000, 1_350_000, 1_250_000, 1_150_000, 1_075_000, 1_000_000],
  3: [900_000, 800_000, 700_000, 600_000, 550_000, 500_000, 450_000, 400_000],
  4: [350_000, 300_000, 250_000, 200_000, 175_000, 150_000, 125_000, 100_000],
};

function seasonPrize(level: number, rank: number) {
  return DIVISION_PRIZES[level]?.[rank - 1] || 0;
}

/** Read-only gate executed before the rollover lock is acquired. */
async function readRolloverGroupPreflight(db: any, sourceSeason: number, allowTestSeasonRecovery = false) {
  const [tablesSnap, matchesSnap, slotsSnap] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
    db.collection('matches_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', sourceSeason).where('leagueId', '==', LEAGUE_ID).get(),
  ]);
  const canonicalMatches = matchesSnap.docs.filter((doc: any) => {
    const match = doc.data() || {};
    const type = String(match.type || match.matchType || match.competitionType || '').toLowerCase();
    if (/(cup|tournament|friendly|scrim|pyramid)/.test(type) || match.isCup === true || match.isFriendly === true || match.tournamentId || match.cupId) return false;
    const level = Number(match.level || match.division || 0);
    const group = Number(match.groupId || match.group || 0);
    const homeRank = Number(match.homeRank || 0);
    const awayRank = Number(match.awayRank || 0);
    return level >= 1 && level <= MAX_LEVELS && group >= 1 && group <= Math.pow(2, level - 1) &&
      homeRank >= 1 && homeRank <= TEAMS_PER_GROUP && awayRank >= 1 && awayRank <= TEAMS_PER_GROUP && homeRank !== awayRank &&
      (!match.leagueId || String(match.leagueId) === LEAGUE_ID);
  });
  const diagnostics: any[] = [];
  const inspections: any[] = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const key = groupKey(level, group);
      const tableDoc = tablesSnap.docs.find((doc: any) => {
        const data = doc.data() || {};
        return groupKey(Number(data.level || 0), Number(data.group || 0)) === key && String(data.leagueId || LEAGUE_ID) === LEAGUE_ID;
      });
      const fixtures = canonicalMatches
        .map((doc: any) => doc.data() || {})
        .filter((match: any) => Number(match.level || match.division || 0) === level && Number(match.groupId || match.group || 0) === group);
      const slots = slotsSnap.docs
        .map((doc: any) => doc.data() || {})
        .filter((slot: any) => Number(slot.division || slot.level || 0) === level && Number(slot.group || 0) === group);
      const inspection = inspectRolloverGroup(sourceSeason, allowTestSeasonRecovery, tableDoc?.data()?.stats || {}, fixtures, slots, TEAMS_PER_GROUP);
      const reasons = tableDoc ? inspection.reasons : [...inspection.reasons, 'TABLE_MISSING'];
      inspections.push({
        group: key,
        completeFixtures: inspection.completeFixtures,
        fixtureStructureComplete: inspection.fixtureStructureComplete,
        slotConflicts: inspection.slotConflicts,
        reasons,
      });
      if (!inspection.ready || reasons.length || inspection.recoveryRequired) {
        diagnostics.push({
          group: key,
          reasons: inspection.recoveryReasons || reasons,
          slotConflicts: inspection.recoverySlotConflicts || inspection.slotConflicts,
          staleRows: inspection.recoveryStaleRows || inspection.staleRows,
          recoveryRequired: inspection.recoveryRequired === true,
        });
      }
    }
  }
  // Unfinished results may be settled by the rollover path, but only when the
  // complete canonical fixture shape and all standings/slot identities are
  // already unambiguous. Structural conflicts still block before settlement.
  const result = evaluateRolloverPreflight(inspections, { allowUnfinished: true });
  return { ...result, diagnostics, observedTables: tablesSnap.size, observedMatches: canonicalMatches.length };
}

/** Read-only preflight exposed to the protected diagnostic route. */
export async function diagnoseSeasonRolloverPreflight(
  db: any,
  sourceSeason: number,
  allowTestSeasonRecovery = false,
): Promise<Record<string, any>> {
  return await readRolloverGroupPreflight(db, sourceSeason, allowTestSeasonRecovery);
}

/**
 * Awards are applied through a per-player transaction and a season-specific ledger,
 * so retries and concurrent orchestrator ticks cannot pay a club twice.
 * The existing profile UI reads the `trophies` array from players_v14.
 */
async function applySeasonAwards(db: any, sourceSeason: number, standings: Record<string, TeamRow[]>, lock: { ownerId: string; token: string }) {
  let rewardedClubs = 0;
  let totalCredits = 0;
  let trophiesAwarded = 0;
  const missingProfileUids: string[] = [];
  const champion = standings['D1-G1']?.[0];
  const pyramidCupSnap = await db.collection('cup_pyramid_v1').doc(`cup_s${sourceSeason}_l${LEAGUE_ID}`).get();
  const pyramidCupWinnerId = pyramidCupSnap.exists ? String(pyramidCupSnap.data()?.winnerId || '') : '';

  for (const [group, rows] of Object.entries(standings)) {
    const match = /^D([1-4])-G(\d+)$/.exec(group);
    if (!match) continue;
    const level = Number(match[1]);
    for (const row of rows) {
      const uid = String(row?.id || '');
      // Bots have no player wallet/profile to reward.
      if (!uid || uid.startsWith('BOT_')) continue;
      const prize = seasonPrize(level, Number(row.rank));
      const playerRef = db.collection('players_v14').doc(uid);
      const txRef = db.collection('economy_transactions').doc(`season_${sourceSeason}_${uid}`);
      const isChampion = champion && String(champion.id) === uid;

      const result = await db.runTransaction(async (t: any) => {
        const lockRef = db.collection('system_v1').doc('season_rollover_v1');
        const [lockSnap, playerSnap, transactionSnap] = await Promise.all([t.get(lockRef), t.get(playerRef), t.get(txRef)]);
        const currentLock = lockSnap.exists ? lockSnap.data() || {} : {};
        const nowMs = Date.now();
        if (currentLock.ownerId !== lock.ownerId || currentLock.token !== lock.token ||
            Number(currentLock.expiresAtMs || 0) <= nowMs) {
          throw new Error('SEASON_ROLLOVER_LOCK_LOST');
        }
        t.set(lockRef, { expiresAtMs: nowMs + SEASON_ROLLOVER_LOCK_TTL_MS, renewedAtMs: nowMs }, { merge: true });
        const player = playerSnap.exists ? playerSnap.data() || {} : {};
        const recipientState = resolveSeasonAwardRecipientState(playerSnap.exists, transactionSnap.exists, player, sourceSeason);
        if (recipientState === 'ALREADY_APPLIED') return { paid: false, trophy: false };
        if (recipientState === 'PROFILE_MISSING') return { paid: false, trophy: false, missingProfile: true };
        const awardKey = `S${sourceSeason}`;
        const awards = player.seasonAwards && typeof player.seasonAwards === 'object' ? player.seasonAwards : {};

        const before = Math.max(0, Math.floor(Number(player.credits) || 0));
        const after = before + prize;
        const existingTrophies = Array.isArray(player.trophies) ? player.trophies : [];
        const trophyId = `league-cup-season-${sourceSeason}`;
        const pyramidTrophyId = `pyramid-cup-season-${sourceSeason}`;
        const hasCup = existingTrophies.some((item: any) => item?.id === trophyId);
        const hasPyramidCup = existingTrophies.some((item: any) => item?.id === pyramidTrophyId);
        const shouldAddCup = Boolean(isChampion && !hasCup);
        const shouldAddPyramidCup = Boolean(pyramidCupWinnerId && pyramidCupWinnerId === uid && !hasPyramidCup);
        let trophies = existingTrophies;
        if (shouldAddCup) trophies = [...trophies, {
          id: trophyId,
          name: `РљСѓР±РѕРє Р»РёРіРё вЂ” СЃРµР·РѕРЅ ${sourceSeason}`,
          type: 'league_champion',
          date: new Date().toISOString(),
          reward: prize,
          season: sourceSeason,
          division: 1,
          rank: 1,
        }];
        if (shouldAddPyramidCup) trophies = [...trophies, {
          id: pyramidTrophyId,
          name: `РљСѓР±РѕРє РџРёСЂР°РјРёРґС‹ вЂ” СЃРµР·РѕРЅ ${sourceSeason}`,
          type: 'pyramid_cup_champion',
          date: new Date().toISOString(),
          season: sourceSeason,
        }];

        t.update(playerRef, {
          credits: after,
          seasonAwards: { ...awards, [awardKey]: { season: sourceSeason, division: level, group: Number(match[2]), rank: Number(row.rank), prize, awardedAt: FieldValue.serverTimestamp() } },
          ...(shouldPersistSeasonTrophies(shouldAddCup, shouldAddPyramidCup) ? { trophies } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
        t.set(txRef, {
          userId: uid,
          amount: prize,
          currency: 'credits',
          type: 'LEAGUE_SEASON_REWARD',
          referenceId: `S${sourceSeason}`,
          description: `Season ${sourceSeason} finish: Division ${level}, place ${Number(row.rank)}`,
          division: level,
          group: Number(match[2]),
          rank: Number(row.rank),
          balanceBefore: before,
          balanceAfter: after,
          timestamp: FieldValue.serverTimestamp(),
        });
        return { paid: true, trophy: shouldAddCup || shouldAddPyramidCup };
      });
      if (result.paid) { rewardedClubs++; totalCredits += prize; }
      if (result.trophy) trophiesAwarded++;
      if (result.missingProfile) missingProfileUids.push(uid);
    }
  }
  return {
    ready: missingProfileUids.length === 0,
    ...(missingProfileUids.length ? { reason: 'SEASON_AWARD_PLAYER_PROFILE_MISSING', missingProfileCount: missingProfileUids.length, missingProfileUids } : {}),
    rewardedClubs,
    totalCredits,
    trophiesAwarded,
  };
}

/**
 * Build an immutable season archive and the next season's promotion/relegation plan.
 * It never archives an incomplete season and is safe to retry.
 */
export async function prepareSeasonRollover(db: any, sourceSeason: number, targetSeason: number, allowTestSeasonRecovery = false): Promise<Record<string, any>> {
  return await runTwoPhaseSeasonOrchestration<any, any, Record<string, any>>({
    readState: async () => {
      const boundary = await checkSeason1To2Boundary(db, sourceSeason, targetSeason);
      if (!boundary.ready) return boundary;
      const preflight = await readRolloverGroupPreflight(db, sourceSeason, allowTestSeasonRecovery);
      return { ...preflight, seasonBoundary: boundary };
    },
    preflight: state => ({ ...state, reason: state.reason || 'SEASON_STANDINGS_PREFLIGHT_FAILED' }),
    acquireLock: () => acquireSeasonRolloverLock(db, sourceSeason, targetSeason),
    onLockUnavailable: lock => ({ ready: false, reason: 'SEASON_ROLLOVER_LOCKED', sourceSeason, targetSeason, lockExpiresAtMs: lock.expiresAtMs, writesStarted: false }),
    releaseLock: lock => releaseSeasonRolloverLock(db, lock.ownerId, lock.token),
    commit: async (_lockedPreflight, lock) => {
  // Re-check the configuration after acquiring the lock and immediately before
  // the first possible write; a stale preflight must never authorize a rollover.
  const boundary = await checkSeason1To2Boundary(db, sourceSeason, targetSeason);
  if (!boundary.ready) return { ...boundary, writesStarted: false };
  const archiveRef = db.collection('league_season_archives_v1').doc(`S${sourceSeason}`);
  const planRef = db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`);
  const [archiveSnap, planSnap, initialTablesSnap, allSeasonMatchesSnap, initialSlotsSnap] = await Promise.all([
    archiveRef.get(), planRef.get(),
    db.collection('league_tables_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
    db.collection('matches_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', sourceSeason).where('leagueId', '==', LEAGUE_ID).get(),
  ]);
  // A preparing archive is a durable snapshot. If the process crashed after the
  // archive was fully written but before the rollover plan was published, resume
  // exclusively from that snapshot. Never rebuild standings from mutable live
  // matches/tables in this recovery path.
  if (archiveSnap.exists && String((archiveSnap.data() || {}).status || '') === 'preparing' && !planSnap.exists) {
    const savedMatchesSnap = await archiveRef.collection('matches').get();
    const archiveData = archiveSnap.data() || {};
    const savedMatches = savedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const archiveValidation = validateSeasonArchiveSnapshot(archiveData, savedMatches);
    if (!archiveValidation.valid) {
      return {
        ready: false,
        reason: 'SEASON_ARCHIVE_RECOVERY_SNAPSHOT_INVALID',
        sourceSeason,
        targetSeason,
        writesStarted: true,
        archiveMatches: savedMatches.length,
        archiveErrors: archiveValidation.reasons,
      };
    }

    const placementResult = buildPromotionRelegationGroups(archiveData.standings || {});
    if (!placementResult.ready) {
      return {
        ready: false,
        reason: 'SEASON_ARCHIVE_RECOVERY_STANDINGS_INVALID',
        sourceSeason,
        targetSeason,
        group: placementResult.group,
        count: placementResult.count,
        writesStarted: true,
      };
    }

    const awards = await applySeasonAwards(db, sourceSeason, archiveData.standings || {}, lock);
    if (!awards.ready) {
      return { ready: false, reason: awards.reason, sourceSeason, targetSeason, writesStarted: true, awards };
    }

    const placements = placementResult.groups as Record<string, TeamRow[]>;
    await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
      ref: planRef,
      data: {
        sourceSeason,
        targetSeason,
        leagueId: LEAGUE_ID,
        ready: true,
        createdAt: FieldValue.serverTimestamp(),
        promotionRule: 'group_champion_up; bottom_two_down_to_child_groups; division_1_and_4_boundaries_preserved',
        groups: placements,
        awards,
        recoveredFromArchiveSnapshot: true,
      },
      options: { merge: false },
    }]);

    const [finalArchiveSnap, finalMatchesSnap, finalPlanSnap] = await Promise.all([
      archiveRef.get(),
      archiveRef.collection('matches').get(),
      planRef.get(),
    ]);
    const finalArchive = finalArchiveSnap.exists ? finalArchiveSnap.data() || {} : {};
    const finalMatches = finalMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const finalPlan = finalPlanSnap.exists ? finalPlanSnap.data() || {} : {};
    if (!isSeasonArchiveReadyToComplete(finalArchive, finalMatches, finalPlan)) {
      return {
        ready: false,
        reason: 'SEASON_ARCHIVE_RECOVERY_FINALIZATION_FAILED',
        sourceSeason,
        targetSeason,
        writesStarted: true,
        archiveMatches: finalMatches.length,
      };
    }
    await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
      ref: archiveRef,
      data: { status: 'completed', completedAt: FieldValue.serverTimestamp() },
      options: { merge: true },
    }]);
    return {
      ready: true,
      completed: true,
      recoveredFromArchiveSnapshot: true,
      sourceSeason,
      targetSeason,
      expectedMatches: EXPECTED_MATCHES,
      observedMatches: savedMatches.length,
      groupCount: Object.keys(placements).length,
      awards,
    };
  }

  // Mutable snapshots are refreshed after any explicit Season 1 repair writes.
  // Keep them in this commit callback scope for all subsequent validation.
  let tablesSnap = initialTablesSnap;
  let slotsSnap = initialSlotsSnap;
  // Legacy league documents may lack `type: league`; include those only when
  // they carry league group coordinates, while excluding explicitly typed cups.
  const leagueMatchDocs = allSeasonMatchesSnap.docs.filter((doc: any) => {
    const m = doc.data() || {};
    const type = String(m.type || m.matchType || '').toLowerCase();
    if (type.includes('cup') || type.includes('tournament') || type === 'friendly' || type.includes('scrim')) return false;
    // Do not require leagueId === ALPHA in the Firestore query: older canonical
    // fixtures may have valid season/version/group coordinates but no leagueId.
    // Requiring that field made the rollover see zero matches and deadlock.
    const hasLeagueCoordinates = Number(m.level) >= 1 && Number(m.level) <= MAX_LEVELS && Number(m.groupId) >= 1;
    return type === 'league' || hasLeagueCoordinates || (!type && hasLeagueCoordinates);
  });
  // READ-ONLY structural preflight: do not settle matches, archive results, or
  // award credits until the canonical Season 1 fixture structure is verified.
  const preflightGroups = new Map<string, Set<string>>();
  let preflightCanonicalCount = 0;
  let preflightDuplicateCount = 0;
  for (const doc of leagueMatchDocs) {
    const m = doc.data() || {};
    const type = String(m?.matchType || m?.type || m?.competitionType || '').toLowerCase();
    if (/(cup|tournament|friendly|scrim|pyramid)/.test(type)) continue;
    if (m?.isCup === true || m?.isFriendly === true || m?.tournamentId || m?.cupId) continue;
    const level = Number(m?.level || m?.division || 0);
    const group = Number(m?.groupId || m?.group || 0);
    const homeRank = Number(m?.homeRank || 0);
    const awayRank = Number(m?.awayRank || 0);
    const hasCoordinates = level >= 1 && level <= MAX_LEVELS && group >= 1 && group <= Math.pow(2, level - 1);
    const canonicalRanks = homeRank >= 1 && homeRank <= TEAMS_PER_GROUP && awayRank >= 1 && awayRank <= TEAMS_PER_GROUP && homeRank !== awayRank;
    if (!hasCoordinates || !canonicalRanks || (m?.leagueId && String(m.leagueId) !== LEAGUE_ID)) continue;
    preflightCanonicalCount++;
    const key = groupKey(level, group);
    if (!preflightGroups.has(key)) preflightGroups.set(key, new Set<string>());
    const fixtures = preflightGroups.get(key)!;
    const fixtureKey = `${homeRank}>${awayRank}`;
    if (fixtures.has(fixtureKey)) preflightDuplicateCount++;
    fixtures.add(fixtureKey);
  }
  const preflightExpectedGroups = TOTAL_GROUPS;
  const preflightBadGroups: Array<{ group: string; matches: number }> = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const key = groupKey(level, group);
      const count = preflightGroups.get(key)?.size || 0;
      if (count !== TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1)) {
        preflightBadGroups.push({ group: key, matches: count });
      }
    }
  }
  if (
    preflightCanonicalCount !== EXPECTED_MATCHES ||
    preflightDuplicateCount !== 0 ||
    preflightGroups.size !== preflightExpectedGroups ||
    preflightBadGroups.length > 0 ||
    tablesSnap.size !== TOTAL_GROUPS
  ) {
    return {
      ready: false,
      reason: 'SEASON_STRUCTURE_PREFLIGHT_FAILED',
      sourceSeason,
      targetSeason,
      expectedMatches: EXPECTED_MATCHES,
      observedLeagueDocuments: leagueMatchDocs.length,
      canonicalMatches: preflightCanonicalCount,
      duplicateCanonicalFixtures: preflightDuplicateCount,
      expectedTables: TOTAL_GROUPS,
      observedTables: tablesSnap.size,
      badGroups: preflightBadGroups.slice(0, 10),
      writesStarted: false
    };
  }

  // SAFETY: rollover preparation must never mutate or re-simulate Season 1 match
  // documents. Match resolution is a separate workflow; this function only archives
  // persisted, valid results. If any canonical fixture is incomplete, stop before
  // writing archive, plan, awards, standings, slots, or match documents.
  const needsSettlement = leagueMatchDocs.filter((doc: any) => {
    const m = doc.data() || {};
    const type = String(m?.matchType || m?.type || m?.competitionType || '').toLowerCase();
    if (/(cup|tournament|friendly|scrim|pyramid)/.test(type)) return false;
    if (m?.isCup === true || m?.isFriendly === true || m?.tournamentId || m?.cupId) return false;
    const level = Number(m?.level || m?.division || 0);
    const group = Number(m?.groupId || m?.group || 0);
    const homeRank = Number(m?.homeRank || 0);
    const awayRank = Number(m?.awayRank || 0);
    const canonical = level >= 1 && level <= MAX_LEVELS && group >= 1 && group <= Math.pow(2, level - 1) &&
      homeRank >= 1 && homeRank <= TEAMS_PER_GROUP && awayRank >= 1 && awayRank <= TEAMS_PER_GROUP &&
      homeRank !== awayRank && (!m?.leagueId || String(m.leagueId) === LEAGUE_ID);
    return canonical && (m.isFinished !== true || m.status !== 'finished' || !scoreOf(m));
  });
  if (needsSettlement.length > 0) {
    return {
      ready: false,
      reason: 'SEASON_RESULTS_INCOMPLETE',
      sourceSeason,
      targetSeason,
      unfinishedCanonicalMatches: needsSettlement.length,
      matchIds: needsSettlement.slice(0, 20).map((doc: any) => doc.id),
      writesStarted: false,
      safeAction: 'RESOLVE_MATCHES_SEPARATELY_THEN_RETRY',
    };
  }

  // Season 1's explicit recovery mode may repair deterministic projection drift.
  // Build every repair first; if even one group is ambiguous, write nothing.
  if (allowTestSeasonRecovery && sourceSeason === 1) {
    const repairPlans: Array<{
      group: string;
      tableRef: any;
      slotUpdates: Array<{ ref: any; rank: number; occupantId: string | null; status: 'FREE' | 'OCCUPIED' }>;
      rebuiltStats?: Record<string, any>;
    }> = [];

    for (let level = 1; level <= MAX_LEVELS; level++) {
      for (let group = 1; group <= Math.pow(2, level - 1); group++) {
        const key = groupKey(level, group);
        const tableDoc = tablesSnap.docs.find((doc: any) => {
          const data = doc.data() || {};
          return groupKey(Number(data.level || 0), Number(data.group || 0)) === key && String(data.leagueId || LEAGUE_ID) === LEAGUE_ID;
        });
        const fixtureDocs = leagueMatchDocs.filter((doc: any) => {
          const match = doc.data() || {};
          return Number(match.level || match.division || 0) === level && Number(match.groupId || match.group || 0) === group;
        });
        const fixtures = fixtureDocs.map((doc: any) => doc.data() || {});
        const slotDocs = slotsSnap.docs.filter((doc: any) => {
          const slot = doc.data() || {};
          return Number(slot.division || slot.level || 0) === level && Number(slot.group || 0) === group;
        });
        const slotData = slotDocs.map((doc: any) => doc.data() || {});
        const slotRepairs = buildCanonicalSlotRepairs(fixtures, slotData, TEAMS_PER_GROUP);
        if (!tableDoc || !hasCanonicalFixtureStructure(fixtures, TEAMS_PER_GROUP) || !slotRepairs) {
          return { ready: false, reason: 'SEASON_RECOVERY_UNSAFE_GROUP', sourceSeason, targetSeason, group: key, writesStarted: false };
        }
        const slotUpdates = slotRepairs.map(repair => {
          const slotDoc = slotDocs.find((doc: any) => Number((doc.data() || {}).rank) === repair.rank);
          if (!slotDoc) throw new Error(`Missing slot document for ${key} rank ${repair.rank}`);
          return { ref: slotDoc.ref, ...repair };
        });
        const currentStats = tableDoc.data()?.stats || {};
        const rebuiltStats = calculateGroupStandings(currentStats, fixtures, TEAMS_PER_GROUP);
        const statsProjection = hasCompleteCanonicalFixtureSet(fixtures, TEAMS_PER_GROUP) && rebuiltStats.length === TEAMS_PER_GROUP
          ? Object.fromEntries(rebuiltStats.map((row: any, index: number) => {
              const id = String(row.id);
              return [id, { ...row, id, rank: index + 1 }];
            }))
          : undefined;
        repairPlans.push({ group: key, tableRef: tableDoc.ref, slotUpdates, rebuiltStats: statsProjection });
      }
    }

    // One bounded batch (120 slots + 15 table projections = at most 135 writes).
    const repairWrites: Array<{ ref: any; data: any; options: any }> = [];
    let repairWriteCount = 0;
    for (const plan of repairPlans) {
      for (const slot of plan.slotUpdates) {
        const existing = slotsSnap.docs.find((doc: any) => doc.ref.path === slot.ref.path)?.data() || {};
        if (String(existing.occupantId || '') !== String(slot.occupantId || '') || existing.status !== slot.status) {
          repairWrites.push({ ref: slot.ref, data: { occupantId: slot.occupantId, status: slot.status, updatedAt: FieldValue.serverTimestamp() }, options: { merge: true } });
          repairWriteCount++;
        }
      }
      if (plan.rebuiltStats && JSON.stringify(tablesSnap.docs.find((doc: any) => doc.ref.path === plan.tableRef.path)?.data()?.stats || {}) !== JSON.stringify(plan.rebuiltStats)) {
        repairWrites.push({ ref: plan.tableRef, data: { stats: plan.rebuiltStats, updatedAt: FieldValue.serverTimestamp() }, options: { merge: true } });
        repairWriteCount++;
      }
    }
    if (repairWriteCount > 0) await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, repairWrites);
    if (repairWriteCount > 0) {
      [tablesSnap, slotsSnap] = await Promise.all([
        db.collection('league_tables_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
        db.collection('league_slots_v1').where('season', '==', sourceSeason).where('leagueId', '==', LEAGUE_ID).get(),
      ]);
    }
  }

  // Completed fixtures are authoritative for standings. In the explicit Season 1
  // recovery path, slot and table projections were repaired under the rollover lock.
  const groupConsistency = [] as Array<{ group: string; reasons: string[]; slotConflicts: any[]; staleRows: string[] }>;
  const groupInspections: any[] = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const key = groupKey(level, group);
      const tableDoc = tablesSnap.docs.find((doc: any) => {
        const data = doc.data() || {};
        return groupKey(Number(data.level || 0), Number(data.group || 0)) === key;
      });
      const fixtures = leagueMatchDocs
        .map((doc: any) => doc.data() || {})
        .filter((match: any) => Number(match.level || match.division || 0) === level && Number(match.groupId || match.group || 0) === group);
      const slots = slotsSnap.docs
        .map((doc: any) => doc.data() || {})
        .filter((slot: any) => Number(slot.division || slot.level || 0) === level && Number(slot.group || 0) === group);
      const inspection = inspectRolloverGroup(sourceSeason, allowTestSeasonRecovery, tableDoc?.data()?.stats || {}, fixtures, slots, TEAMS_PER_GROUP);
      const reasons = tableDoc ? inspection.reasons : [...inspection.reasons, 'TABLE_MISSING'];
      groupInspections.push({ group: key, completeFixtures: inspection.completeFixtures, fixtureStructureComplete: inspection.fixtureStructureComplete, slotConflicts: inspection.slotConflicts, reasons });
      if (reasons.length || inspection.staleRows.length) {
        groupConsistency.push({ group: key, reasons, slotConflicts: inspection.slotConflicts, staleRows: inspection.staleRows });
      }
    }
  }
  const preflightResult = evaluateRolloverPreflight(groupInspections, { allowUnfinished: true });
  if (!preflightResult.ready) {
    return {
      ready: false,
      reason: preflightResult.reason,
      sourceSeason,
      targetSeason,
      groups: groupConsistency.slice(0, 10),
      writesStarted: false,
    };
  }
  const [freshSeasonMatches, freshTablesSnap, freshSlotsSnap] = await Promise.all([
    db.collection('matches_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
    db.collection('league_tables_v2').where('season', '==', sourceSeason).where('version', '==', 140).get(),
    db.collection('league_slots_v1').where('season', '==', sourceSeason).where('leagueId', '==', LEAGUE_ID).get(),
  ]);
  const filteredLeagueDocs = freshSeasonMatches.docs.filter((doc: any) => {
    const m = doc.data() || {};
    const type = String(m.type || m.matchType || '').toLowerCase();
    if (type.includes('cup') || type.includes('tournament') || type === 'friendly' || type.includes('scrim')) return false;
    const hasLeagueCoordinates = Number(m.level) >= 1 && Number(m.level) <= MAX_LEVELS && Number(m.groupId) >= 1;
    return type === 'league' || hasLeagueCoordinates;
  });
  const matchesSnap = { docs: filteredLeagueDocs, size: filteredLeagueDocs.length };
  const finalInspections: any[] = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const key = groupKey(level, group);
      const tableDoc = freshTablesSnap.docs.find((doc: any) => {
        const data = doc.data() || {};
        return groupKey(Number(data.level || 0), Number(data.group || 0)) === key && String(data.leagueId || LEAGUE_ID) === LEAGUE_ID;
      });
      const fixtures = filteredLeagueDocs
        .map((doc: any) => doc.data() || {})
        .filter((match: any) => Number(match.level || match.division || 0) === level && Number(match.groupId || match.group || 0) === group);
      const slots = freshSlotsSnap.docs
        .map((doc: any) => doc.data() || {})
        .filter((slot: any) => Number(slot.division || slot.level || 0) === level && Number(slot.group || 0) === group);
      const inspection = inspectRolloverGroup(sourceSeason, allowTestSeasonRecovery, tableDoc?.data()?.stats || {}, fixtures, slots, TEAMS_PER_GROUP);
      finalInspections.push({ group: key, ...inspection });
    }
  }
  const finalPreflight = evaluateRolloverPreflight(finalInspections);
  if (!finalPreflight.ready) {
    return {
      ready: false,
      reason: finalPreflight.reason,
      sourceSeason,
      targetSeason,
      writesStarted: true,
      failedGroups: finalPreflight.failedGroups,
      diagnostics: finalInspections.filter(item => !item.ready),
    };
  }
  const existingPlanValid = planSnap.exists && validateRolloverPlan(planSnap.data(), sourceSeason, targetSeason).valid;
  if (archiveSnap.exists && (archiveSnap.data() || {}).status === 'completed' && !existingPlanValid) {
    return { ready: false, reason: 'COMPLETED_SEASON_ARCHIVE_PLAN_MISSING_OR_INVALID', sourceSeason, targetSeason, writesStarted: false };
  }
  if (archiveSnap.exists && existingPlanValid) {
    const archiveData = archiveSnap.data() || {};
    const savedMatchesSnap = await archiveRef.collection('matches').get();
    const savedMatches = savedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const archiveValidation = validateSeasonArchiveSnapshot(archiveData, savedMatches);
    if (!archiveValidation.valid) {
      return { ready: false, reason: 'SEASON_ARCHIVE_VALIDATION_FAILED', sourceSeason, targetSeason, writesStarted: false, archiveMatches: savedMatches.length, archiveErrors: archiveValidation.reasons };
    }
    const awards = await applySeasonAwards(db, sourceSeason, archiveData.standings || {}, lock);
    if (!awards.ready) {
      return { ready: false, reason: awards.reason, sourceSeason, targetSeason, writesStarted: true, awards };
    }
    await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
      ref: planRef,
      data: { awards },
      options: { merge: true },
    }]);
    const refreshedPlanSnap = await planRef.get();
    if (!isSeasonArchiveReadyToComplete(archiveData, savedMatches, refreshedPlanSnap.data() || {})) {
      return { ready: false, reason: 'SEASON_ARCHIVE_FINALIZATION_VALIDATION_FAILED', sourceSeason, targetSeason, writesStarted: true, awards };
    }
    if (archiveData.status !== 'completed' || !archiveData.completedAt) {
      await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
        ref: archiveRef,
        data: { status: 'completed', completedAt: FieldValue.serverTimestamp() },
        options: { merge: true },
      }]);
    }
    return { ready: true, alreadyPrepared: true, completed: true, sourceSeason, targetSeason, expectedMatches: EXPECTED_MATCHES, observedMatches: matchesSnap.size, awards };
  }
  // Only canonical league fixtures count toward standings. Legacy/corrupt extra rows
  // (for example a ninth team in D1-G1), cups and friendlies must not block rollover.
  const isLeagueFixture = (m: any) => {
    const type = String(m?.matchType || m?.type || m?.competitionType || '').toLowerCase();
    if (/(cup|tournament|friendly|scrim|pyramid)/.test(type)) return false;
    if (m?.isCup === true || m?.isFriendly === true || m?.tournamentId || m?.cupId) return false;
    const level = Number(m?.level || m?.division || 0);
    const group = Number(m?.groupId || m?.group || 0);
    const homeRank = Number(m?.homeRank || 0);
    const awayRank = Number(m?.awayRank || 0);
    const hasCoordinates = level >= 1 && level <= MAX_LEVELS && group >= 1 && group <= Math.pow(2, level - 1);
    const canonicalRanks = homeRank >= 1 && homeRank <= TEAMS_PER_GROUP && awayRank >= 1 && awayRank <= TEAMS_PER_GROUP && homeRank !== awayRank;
    // Explicit ALPHA league IDs are preferred. Legacy version-140 records without
    // leagueId remain eligible only when they carry canonical league coordinates.
    return hasCoordinates && canonicalRanks && (!m?.leagueId || String(m.leagueId) === LEAGUE_ID);
  };
  const canonicalByGroup = new Map<string, Map<string, any>>();
  let unfinished = 0;
  let invalidResults = 0;
  let duplicateCanonicalFixtures = 0;
  for (const doc of matchesSnap.docs) {
    const m = doc.data() || {};
    if (!isLeagueFixture(m)) continue;
    const level = Number(m.level || m.division || 0);
    const group = Number(m.groupId || m.group || 0);
    const key = groupKey(level, group);
    if (!canonicalByGroup.has(key)) canonicalByGroup.set(key, new Map());
    const fixtures = canonicalByGroup.get(key)!;
    const fixtureKey = `${Number(m.homeRank)}>${Number(m.awayRank)}`;
    const existing = fixtures.get(fixtureKey);
    if (existing) {
      duplicateCanonicalFixtures++;
      // Prefer a finished fixture with a valid score; otherwise retain the newest
      // candidate so the integrity report remains deterministic across retries.
      const currentValid = existing.data?.isFinished === true && scoreOf(existing.data);
      const candidateValid = m.isFinished === true && scoreOf(m);
      const currentTime = Date.parse(String(existing.data?.resolvedAt || existing.data?.updatedAt || existing.data?.startTime || '')) || 0;
      const candidateTime = Date.parse(String(m.resolvedAt || m.updatedAt || m.startTime || '')) || 0;
      if ((!currentValid && candidateValid) || (Boolean(currentValid) === Boolean(candidateValid) && candidateTime > currentTime)) {
        fixtures.set(fixtureKey, { id: doc.id, data: m });
      }
    } else {
      fixtures.set(fixtureKey, { id: doc.id, data: m });
    }
  }
  const expectedGroups = new Set<string>();
  for (let level = 1; level <= MAX_LEVELS; level++) for (let group = 1; group <= Math.pow(2, level - 1); group++) expectedGroups.add(groupKey(level, group));
  const groupIntegrity = [...expectedGroups].map(key => {
    const fixtures = [...(canonicalByGroup.get(key)?.values() || [])];
    return { group: key, matches: fixtures.length, finished: fixtures.filter(x => x.data.isFinished === true && scoreOf(x.data)).length };
  });
  const badGroups = groupIntegrity.filter(g => g.matches !== TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1) || g.finished !== g.matches);
  const canonicalMatches = [...canonicalByGroup.values()].flatMap(map => [...map.values()]);
  unfinished = canonicalMatches.filter(x => x.data.isFinished !== true).length;
  invalidResults = canonicalMatches.filter(x => x.data.isFinished === true && !scoreOf(x.data)).length;
  if (canonicalMatches.length !== EXPECTED_MATCHES || freshTablesSnap.size !== TOTAL_GROUPS || unfinished > 0 || invalidResults > 0 || badGroups.length > 0 || duplicateCanonicalFixtures > 0) {
    return { ready: false, reason: 'SEASON_RESULTS_INCOMPLETE', sourceSeason, targetSeason, expectedMatches: EXPECTED_MATCHES, observedMatches: matchesSnap.size, canonicalMatches: canonicalMatches.length, duplicateCanonicalFixtures, ignoredLegacyOrNonLeagueMatches: matchesSnap.size - canonicalMatches.length, expectedTables: TOTAL_GROUPS, observedTables: tablesSnap.size, unfinishedMatches: unfinished, invalidResults, badGroups: badGroups.slice(0, 10) };
  }

  const matchArchive: any[] = [];
  const fixturesByGroup = new Map<string, any[]>();
  for (const fixture of canonicalMatches) {
    const m = fixture.data || {};
    const level = Number(m.level || m.division || 0), group = Number(m.groupId || m.group || 0), key = groupKey(level, group), s = scoreOf(m)!;
    if (!fixturesByGroup.has(key)) fixturesByGroup.set(key, []);
    fixturesByGroup.get(key)!.push({ ...m, score: s });
    matchArchive.push({ matchId: fixture.id, version: Number(m.version || 140), sourceSeason, level, group, tour: Number(m.tour || m.day || 0), homeRank: Number(m.homeRank), awayRank: Number(m.awayRank), homeId: String(m.homeId), homeName: String(m.homeName || m.homeId), awayId: String(m.awayId), awayName: String(m.awayName || m.awayId), score: s, status: 'finished', isFinished: true, resolvedAt: m.resolvedAt || null });
  }
  const standings: Record<string, TeamRow[]> = {};
  for (const key of expectedGroups) {
    const tableDoc = freshTablesSnap.docs.find((doc: any) => {
      const data = doc.data() || {};
      return groupKey(Number(data.level || 0), Number(data.group || 0)) === key;
    });
    const rows = calculateGroupStandings(tableDoc?.data()?.stats || {}, fixturesByGroup.get(key) || [], TEAMS_PER_GROUP);
    if (rows.length !== TEAMS_PER_GROUP) return { ready: false, reason: 'STANDINGS_TEAM_COUNT_INVALID', group: key, count: rows.length };
    standings[key] = rows.map((row, i) => ({ ...row, rank: i + 1 }));
  }

  // Persist the canonical standings projection only after every canonical fixture
  // has a valid final result. This removes stale rows/duplicate ranks so the next
  // rollover starts from a consistent table instead of inheriting old projections.
  const standingsWrites: Array<{ ref: any; data: any; options: any }> = [];
  for (const key of expectedGroups) {
    const tableDoc = freshTablesSnap.docs.find((doc: any) => {
      const data = doc.data() || {};
      return groupKey(Number(data.level || 0), Number(data.group || 0)) === key && String(data.leagueId || LEAGUE_ID) === LEAGUE_ID;
    });
    if (!tableDoc) return { ready: false, reason: 'TABLE_MISSING_DURING_STANDINGS_REBUILD', group: key, writesStarted: true };
    const stats = Object.fromEntries((standings[key] || []).map((row: any) => [String(row.id), { ...row, id: String(row.id) }]));
    standingsWrites.push({ ref: tableDoc.ref, data: { stats, updatedAt: FieldValue.serverTimestamp() }, options: { merge: true } });
  }
  await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, standingsWrites);

  const summary = { sourceSeason, finalizedAt: FieldValue.serverTimestamp(), leagueId: LEAGUE_ID, expectedMatches: EXPECTED_MATCHES, finishedMatches: canonicalMatches.length, groups: Object.keys(standings).length, teamCount: Object.values(standings).reduce((n, a) => n + a.length, 0), integrity: { complete: true, unfinishedMatches: 0, invalidResults: 0, canonicalMatches: canonicalMatches.length, ignoredLegacyOrNonLeagueMatches: matchesSnap.size - canonicalMatches.length, duplicateCanonicalFixtures } };

  // Write per-match archive records first; immutable IDs make retries harmless.
  for (let i = 0; i < matchArchive.length; i += 400) {
    const writes = matchArchive.slice(i, i + 400).map((match: any) => ({
      ref: archiveRef.collection('matches').doc(match.matchId),
      data: { ...match, sourceSeason, archivedAt: FieldValue.serverTimestamp() },
      options: { merge: true },
    }));
    await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, writes);
  }
  await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
    ref: archiveRef,
    data: { ...summary, standings, archiveVersion: 1, status: 'preparing' },
    options: { merge: true },
  }]);
  const preparedArchiveSnap = await archiveRef.get();
  const preparedArchive = preparedArchiveSnap.exists ? preparedArchiveSnap.data() || {} : {};
  const preparedMatchesSnap = await archiveRef.collection('matches').get();
  const preparedMatches = preparedMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const archiveValidation = validateSeasonArchiveSnapshot(preparedArchive, preparedMatches);
  if (!archiveValidation.valid) {
    return { ready: false, reason: 'SEASON_ARCHIVE_VALIDATION_FAILED', sourceSeason, targetSeason, writesStarted: true, archiveMatches: preparedMatches.length, archiveErrors: archiveValidation.reasons };
  }

  // Pay clubs and award the D1 champion before the rollover plan is marked ready.
  const awards = await applySeasonAwards(db, sourceSeason, standings, lock);
  if (!awards.ready) {
    return { ready: false, reason: awards.reason, sourceSeason, targetSeason, writesStarted: true, awards };
  }

  // Apply the canonical pyramid movement using the pure, regression-tested
  // placement function. A malformed group blocks the plan before it is persisted.
  const placementResult = buildPromotionRelegationGroups(standings);
  if (!placementResult.ready) {
    return { ready: false, reason: placementResult.reason, group: placementResult.group, count: placementResult.count };
  }
  const placements = placementResult.groups as Record<string, TeamRow[]>;
  await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
    ref: planRef,
    data: { sourceSeason, targetSeason, leagueId: LEAGUE_ID, ready: true, createdAt: FieldValue.serverTimestamp(), promotionRule: 'group_champion_up; bottom_two_down_to_child_groups; division_1_and_4_boundaries_preserved', groups: placements, awards },
    options: { merge: true },
  }]);
  const [finalArchiveSnap, finalMatchesSnap, finalPlanSnap] = await Promise.all([
    archiveRef.get(), archiveRef.collection('matches').get(), planRef.get(),
  ]);
  const finalArchive = finalArchiveSnap.exists ? finalArchiveSnap.data() || {} : {};
  const finalMatches = finalMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const finalPlan = finalPlanSnap.exists ? finalPlanSnap.data() || {} : {};
  if (!isSeasonArchiveReadyToComplete(finalArchive, finalMatches, finalPlan)) {
    return { ready: false, reason: 'SEASON_ARCHIVE_FINALIZATION_VALIDATION_FAILED', sourceSeason, targetSeason, writesStarted: true, archiveMatches: finalMatches.length };
  }
  await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{
    ref: archiveRef,
    data: { status: 'completed', completedAt: FieldValue.serverTimestamp() },
    options: { merge: true },
  }]);
  return { ready: true, completed: true, alreadyPrepared: false, sourceSeason, targetSeason, expectedMatches: EXPECTED_MATCHES, observedMatches: matchesSnap.size, groupCount: Object.keys(placements).length, awards };
    },
  }) as Record<string, any>;
}

