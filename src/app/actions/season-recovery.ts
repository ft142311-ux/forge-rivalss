import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { acquireSeasonRolloverLock, assertSeasonRolloverLock, commitSeasonRolloverWrites, releaseSeasonRolloverLock } from './season-rollover-lock';
import { isCompletedSeasonArchive, isRecoveredSeasonArchive, isSeasonArchiveReadyToComplete, validateSeasonArchiveSnapshot } from './season-archive';
import { validateRolloverPlan } from './season-rollover-plan';
import { buildSeasonRecoveryDocuments, buildSeasonTwoRecoveryDocuments, isValidSeasonTwoRecoveryResult, runWithConcurrency, type SeasonRecoveryDocument, type SeasonTwoRecoveryDocument } from './season-recovery-core';
import { evaluateCanonicalDocuments } from './season-canonical';
import { resolveUniversalMatchDocument } from './universal-match-resolver';
import { rebuildLeagueTablesFromFinishedMatches } from './autonomous-cycle';
import { calculateGroupStandings } from './season-rollover-standings';
import { expectedRolloverGroups } from './season-rollover-plan';
import { FIRST_SEASON_NEXT_START_ISO } from '@/app/lib/time-utils';
import { TOTAL_CYCLE_DAYS } from '@/app/lib/leagues-data';
import { buildMatchTeamSnapshot } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { timestampToMillis } from '@/app/lib/timestamp-utils';
import { prepareSeasonRollover } from './season-rollover';
import { ensureSeasonCalendar, publishPreparedSeason } from './season-calendar';
import { resolveDailyMatches } from './autonomous-cycle';

const S2_START_ISO = '2026-10-08T15:00:00.000Z';
const S3_START_ISO = '2026-10-23T15:00:00.000Z';
const S4_START_ISO = '2026-11-07T15:00:00.000Z';
const RECOVERY_MATCH_BATCH_SIZE = 30;

const GROUPS = Array.from({ length: 15 }, (_, index) => {
  const level = index === 0 ? 1 : index < 3 ? 2 : index < 7 ? 3 : 4;
  const group = index === 0 ? 1 : index < 3 ? index : index < 7 ? index - 2 : index - 6;
  return `D${level}-G${group}`;
});

function confirmedScore(match: any) {
  const home = Number(match?.seriesScore?.home ?? match?.scoreA);
  const away = Number(match?.seriesScore?.away ?? match?.scoreB);
  return match?.isFinished === true && match?.status === 'finished' && Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0 && home <= 2 && away <= 2 && home + away > 0
    ? { home, away } : null;
}

/** Archive only persisted, confirmed S2 results; this recovery archive never claims final standings. */
export async function recoverIncompleteSeasonTwo() {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await configRef.get();
  const config = configSnap.data() || {};
  const resumingTarget3 = Number(config.activeSeasonNumber || 1) === 1 && Number(config.recoveryTargetSeason || 0) === 3 &&
    Number(config.nextSeasonNumber || 0) === 3 && ['WORLD_BUILDING', 'GENERATING_NEXT'].includes(String(config.phase || '')) &&
    (config.nextSeasonStart === '2026-10-08T15:00:00.000Z' || config.nextSeasonStart === '2026-11-07T15:00:00.000Z');
  const originalS1State = Number(config.activeSeasonNumber || 1) === 1 && config.worldReady === true && config.nextSeasonStart === '2026-10-08T15:00:00.000Z';
  if (!originalS1State && !resumingTarget3) {
    return { success: false, reason: 'SEASON_1_STATE_OR_BOUNDARY_MISMATCH', writesStarted: false };
  }
  const [s1ArchiveSnap, s1MatchesSnap, s2PlanSnap, s2MatchesSnap, s2ArchiveSnap] = await Promise.all([
    db.doc('league_season_archives_v1/S1').get(),
    db.collection('league_season_archives_v1').doc('S1').collection('matches').get(),
    db.doc('league_season_rollovers_v1/S2').get(),
    db.collection('matches_v2').where('season', '==', 2).get(),
    db.doc('league_season_archives_v1/S2').get(),
  ]);
  const s1Archive = s1ArchiveSnap.data() || {};
  const s1Matches = s1MatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const s2Plan = s2PlanSnap.data() || {};
  if (!isCompletedSeasonArchive(s1Archive) || !validateSeasonArchiveSnapshot(s1Archive, s1Matches).valid ||
      !validateRolloverPlan(s2Plan, 1, 2).valid) {
    return { success: false, reason: 'SEASON_1_ARCHIVE_OR_S2_PARTICIPANTS_INVALID', writesStarted: false };
  }

  const archiveRef = db.doc('league_season_archives_v1/S2');
  let existingRecoveredArchive: any = null;
  let existingRecoveryInProgress = false;
  if (s2ArchiveSnap.exists) {
    const existing = s2ArchiveSnap.data() || {};
    if (isCompletedSeasonArchive(existing)) return { success: false, reason: 'SEASON_2_ALREADY_COMPLETED_REQUIRES_NORMAL_ROLLOVER', writesStarted: false };
    if (isRecoveredSeasonArchive(existing)) existingRecoveredArchive = existing;
    else if (existing.status === 'recovering' && existing.recovery?.status === 'incomplete' &&
        isRecoveredSeasonArchive({ ...existing, status: 'recovered' })) existingRecoveryInProgress = true;
    else return { success: false, reason: 'CONFLICTING_PARTIAL_SEASON_2_ARCHIVE', writesStarted: false };
  }

  const season2MatchDocs = s2MatchesSnap.docs;
  const ids = new Set<string>();
  const canonicalFixtures = new Set<string>();
  const participantsByGroupRank = new Map<string, string>();
  const archivedMatches: any[] = [];
  let unresolvedMatches = 0;
  for (const doc of season2MatchDocs) {
    const match = doc.data() || {};
    const score = confirmedScore(match);
    if (!score) { unresolvedMatches++; continue; }
    const level = Number(match.level || match.division);
    const group = Number(match.groupId || match.group);
    const homeRank = Number(match.homeRank);
    const awayRank = Number(match.awayRank);
    if (Number(match.season) !== 2 || level < 1 || level > 4 || group < 1 || group > 2 ** (level - 1) ||
        !match.homeId || !match.awayId || match.homeId === match.awayId || homeRank < 1 || homeRank > 8 || awayRank < 1 || awayRank > 8 || homeRank === awayRank || ids.has(doc.id)) {
      return { success: false, reason: 'INVALID_OR_DUPLICATE_SEASON_2_MATCH', matchId: doc.id, writesStarted: false };
    }
    const fixtureKey = `${level}-G${group}-${homeRank}>${awayRank}`;
    const homeKey = `${level}-G${group}-R${homeRank}`;
    const awayKey = `${level}-G${group}-R${awayRank}`;
    if (canonicalFixtures.has(fixtureKey) ||
        (participantsByGroupRank.has(homeKey) && participantsByGroupRank.get(homeKey) !== String(match.homeId)) ||
        (participantsByGroupRank.has(awayKey) && participantsByGroupRank.get(awayKey) !== String(match.awayId))) {
      return { success: false, reason: 'DUPLICATE_OR_CONFLICTING_SEASON_2_FIXTURE', matchId: doc.id, writesStarted: false };
    }
    canonicalFixtures.add(fixtureKey);
    participantsByGroupRank.set(homeKey, String(match.homeId));
    participantsByGroupRank.set(awayKey, String(match.awayId));
    ids.add(doc.id);
    archivedMatches.push({ matchId: doc.id, sourceSeason: 2, version: Number(match.version || 140), level, group, tour: Number(match.tour || match.day || 0), homeRank, awayRank, homeId: String(match.homeId), homeName: String(match.homeName || match.homeId), awayId: String(match.awayId), awayName: String(match.awayName || match.awayId), score, status: 'finished', isFinished: true, resolvedAt: match.resolvedAt || null });
  }
  const startingParticipants = Object.fromEntries(GROUPS.map(group => [group, s2Plan.groups[group].map((row: any) => ({ id: String(row.id), name: String(row.name || row.id), rank: Number(row.rank), isBot: row.isBot === true }))]));
  const lock = await acquireSeasonRolloverLock(db, 1, 2);
  if (!lock.acquired) return { success: false, reason: 'SEASON_ROLLOVER_LOCKED', writesStarted: false };
  try {
    await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
    const check = await archiveRef.get();
    if (check.exists && !existingRecoveredArchive && !existingRecoveryInProgress) return { success: false, reason: 'ARCHIVE_CREATED_CONCURRENTLY', writesStarted: false };
    if (!check.exists) await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{ ref: archiveRef, data: {
      sourceSeason: 2, leagueId: 'ALPHA', archiveVersion: 1, status: 'recovering', expectedMatches: 840,
      finishedMatches: archivedMatches.length, unresolvedMatches: 840 - archivedMatches.length,
      groups: 15, teamCount: 120, standings: {}, startingParticipants,
      integrity: { complete: false, recovery: true, unfinishedMatches: 840 - archivedMatches.length, invalidResults: 0, canonicalMatches: archivedMatches.length, duplicateCanonicalFixtures: 0 },
      recovery: { status: 'incomplete', finalStandingsAvailable: false, reason: 'NO_COMPLETE_SEASON_2_FIXTURE_SET', observedMatchDocuments: season2MatchDocs.length, unresolvedSourceDocuments: unresolvedMatches },
      recoveredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    } }]);
    const childrenSnap = await archiveRef.collection('matches').get();
    const childrenById = new Map(childrenSnap.docs.map((doc: any) => [doc.id, doc.data() || {}]));
    const expectedChildIds = new Set(archivedMatches.map(match => match.matchId));
    if (childrenSnap.docs.some((doc: any) => !expectedChildIds.has(doc.id))) return { success: false, reason: 'UNEXPECTED_RECOVERY_ARCHIVE_MATCH', writesStarted: true };
    const missingChildren = [] as any[];
    for (const match of archivedMatches) {
      const saved: any = childrenById.get(match.matchId);
      if (saved) {
        if (saved.sourceSeason !== 2 || saved.status !== 'finished' || saved.isFinished !== true || Number(saved.score?.home) !== match.score.home || Number(saved.score?.away) !== match.score.away || String(saved.homeId) !== match.homeId || String(saved.awayId) !== match.awayId) return { success: false, reason: 'RECOVERY_ARCHIVE_MATCH_CONFLICT', matchId: match.matchId, writesStarted: true };
      } else missingChildren.push({ ref: archiveRef.collection('matches').doc(match.matchId), data: { ...match, archivedAt: FieldValue.serverTimestamp() } });
    }
    for (let offset = 0; offset < missingChildren.length; offset += 400) {
      await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, missingChildren.slice(offset, offset + 400));
    }
    const s3PlanRef = db.doc('league_season_rollovers_v1/S3');
    const s3PlanSnap = await s3PlanRef.get();
    if (s3PlanSnap.exists && (!validateRolloverPlan(s3PlanSnap.data(), 2, 3).valid || s3PlanSnap.data()?.mode !== 'recovery_carry_forward')) return { success: false, reason: 'CONFLICTING_SEASON_3_PLAN', writesStarted: true };
    if (!s3PlanSnap.exists) await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{ ref: s3PlanRef, data: {
      sourceSeason: 2, targetSeason: 3, leagueId: 'ALPHA', ready: true, mode: 'recovery_carry_forward',
      recoveredSourceArchive: 'S2', promotionRule: 'carry_forward_without_unverified_season_results',
      groups: startingParticipants, createdAt: FieldValue.serverTimestamp(),
    } }]);
    const activationDates = { seasonStart: '2026-10-23T15:00:00.000Z', nextSeasonStart: '2026-11-07T15:00:00.000Z' };
    await db.runTransaction(async (tx: any) => {
      const currentSnap = await tx.get(configRef);
      const current = currentSnap.exists ? currentSnap.data() || {} : {};
      const validBoundary = current.nextSeasonStart === '2026-10-08T15:00:00.000Z' || current.nextSeasonStart === '2026-11-07T15:00:00.000Z';
      if (Number(current.activeSeasonNumber || 1) !== 1 || !validBoundary ||
          (Number(current.recoveryTargetSeason || 0) && (Number(current.recoveryTargetSeason) !== 3 || Number(current.nextSeasonNumber || 0) !== 3))) throw new Error('SEASON_RECOVERY_CONFIG_CONFLICT');
      tx.set(configRef, { nextSeasonNumber: 3, preparationTargetSeason: 3, recoveryTargetSeason: 3, phase: 'WORLD_BUILDING', worldReady: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
    if (!existingRecoveredArchive) await archiveRef.set({ status: 'recovered', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const finalArchiveSnap = await archiveRef.get();
    const finalArchive = finalArchiveSnap.data() || {};
    if (!isRecoveredSeasonArchive(finalArchive)) return { success: false, reason: 'RECOVERED_ARCHIVE_VALIDATION_FAILED', writesStarted: true };
    const finalArchiveMatches = (await archiveRef.collection('matches').get()).docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    if (finalArchiveMatches.length !== archivedMatches.length) return { success: false, reason: 'RECOVERED_MATCH_COUNT_MISMATCH', writesStarted: true };
    return { success: true, alreadyRecovered: Boolean(existingRecoveredArchive), sourceSeason: 2, archiveStatus: 'recovered', finishedMatches: Number(finalArchive.finishedMatches || archivedMatches.length), expectedMatches: 840, unresolvedMatches: Number(finalArchive.unresolvedMatches || 840 - archivedMatches.length), startingParticipantGroups: 15, s3PlanCreated: !s3PlanSnap.exists, ...activationDates };
  } finally {
    await releaseSeasonRolloverLock(db, lock.ownerId, lock.token);
  }
}

/**
 * Reconstruct and finish the missing S2 fixture set with the canonical calendar
 * generator and shared match engine. This deliberately leaves activeSeasonNumber
 * and the already-published S3 carry-forward plan untouched.
 */
export async function completeRecoveredSeasonTwo() {
  const db = getAdminDb();
  const configRef = db.doc('system_v1/season_config');
  const archiveRef = db.doc('league_season_archives_v1/S2');
  const [configSnap, s1ArchiveSnap, s1MatchesSnap, s2PlanSnap, s3PlanSnap, s2ArchiveSnap] = await Promise.all([
    configRef.get(),
    db.doc('league_season_archives_v1/S1').get(),
    db.collection('league_season_archives_v1/S1/matches').get(),
    db.doc('league_season_rollovers_v1/S2').get(),
    db.doc('league_season_rollovers_v1/S3').get(),
    archiveRef.get(),
  ]);
  const config = configSnap.data() || {};
  if (!configSnap.exists || Number(config.activeSeasonNumber) !== 3 || config.phase !== 'REGULAR_SEASON' || config.worldReady !== true ||
      config.seasonStart !== '2026-10-23T15:00:00.000Z' || config.nextSeasonStart !== '2026-11-07T15:00:00.000Z') {
    return { success: false, reason: 'ACTIVE_SEASON_3_CONFIG_MISMATCH', writesStarted: false };
  }
  const s1Archive = s1ArchiveSnap.data() || {};
  const s1Matches = s1MatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const s2Plan = s2PlanSnap.data() || {};
  const s3Plan = s3PlanSnap.data() || {};
  const s2Archive = s2ArchiveSnap.data() || {};
  if (!isCompletedSeasonArchive(s1Archive) || !validateSeasonArchiveSnapshot(s1Archive, s1Matches).valid ||
      !validateRolloverPlan(s2Plan, 1, 2).valid || !validateRolloverPlan(s3Plan, 2, 3).valid || s3Plan.mode !== 'recovery_carry_forward') {
    return { success: false, reason: 'SEASON_1_OR_ROLLOVER_SNAPSHOT_INVALID', writesStarted: false };
  }
  if (s2ArchiveSnap.exists && s2Archive.status === 'completed') {
    const [archiveMatchesSnap, s3PlanFresh] = await Promise.all([
      archiveRef.collection('matches').get(), db.doc('league_season_rollovers_v1/S3').get(),
    ]);
    const archiveMatches = archiveMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const snapshot = validateSeasonArchiveSnapshot(s2Archive, archiveMatches);
    if (!snapshot.valid || !validateRolloverPlan(s3PlanFresh.data(), 2, 3).valid) {
      return { success: false, reason: 'COMPLETED_SEASON_2_ARCHIVE_INVALID', diagnostics: snapshot.reasons, writesStarted: false };
    }
    return { success: true, alreadyCompleted: true, season: 2, archiveStatus: 'completed', finishedMatches: 840, simulatedMatches: Number(s2Archive.reconstruction?.simulatedMatches || 0) };
  }
  if (!s2ArchiveSnap.exists || !['recovered', 'preparing'].includes(String(s2Archive.status || '')) || Number(s2Archive.sourceSeason) !== 2) {
    return { success: false, reason: 'SEASON_2_RECOVERY_ARCHIVE_STATE_INVALID', writesStarted: false };
  }

  const seasonStart = new Date(FIRST_SEASON_NEXT_START_ISO);
  const nextSeasonStart = new Date(seasonStart.getTime() + TOTAL_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  if (nextSeasonStart.toISOString() !== config.seasonStart) {
    return { success: false, reason: 'SEASON_2_CALENDAR_BOUNDARY_MISMATCH', writesStarted: false };
  }

  const lock = await acquireSeasonRolloverLock(db, 2, 3);
  if (!lock.acquired) return { success: false, reason: 'SEASON_2_RECOVERY_LOCKED', lockExpiresAtMs: lock.expiresAtMs, writesStarted: false };
  let writesStarted = false;
  try {
    await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
    const [freshConfig, freshS1, freshS1Matches, freshS2Plan, freshS3Plan, freshArchive] = await Promise.all([
      configRef.get(), db.doc('league_season_archives_v1/S1').get(),
      db.collection('league_season_archives_v1/S1/matches').get(),
      db.doc('league_season_rollovers_v1/S2').get(), db.doc('league_season_rollovers_v1/S3').get(), archiveRef.get(),
    ]);
    const latestConfig = freshConfig.data() || {};
    const latestArchive = freshArchive.data() || {};
    if (Number(latestConfig.activeSeasonNumber) !== 3 || latestConfig.phase !== 'REGULAR_SEASON' || latestConfig.worldReady !== true ||
        latestConfig.seasonStart !== config.seasonStart || latestConfig.nextSeasonStart !== config.nextSeasonStart ||
        !isCompletedSeasonArchive(freshS1.data()) || !validateSeasonArchiveSnapshot(freshS1.data(), freshS1Matches.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id })).map((x: any) => x)).valid ||
        !validateRolloverPlan(freshS2Plan.data(), 1, 2).valid || !validateRolloverPlan(freshS3Plan.data(), 2, 3).valid ||
        (freshArchive.exists && !['recovered', 'preparing'].includes(String(latestArchive.status || '')))) {
      return { success: false, reason: 'SEASON_2_RECOVERY_PREFLIGHT_CHANGED', writesStarted: false };
    }

    const freshS2PlanData = freshS2Plan.data() || {};
    const [tablesSnap, slotsSnap, matchesSnap, profileSnaps] = await Promise.all([
      db.collection('league_tables_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 2).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 2).where('version', '==', 140).get(),
      Promise.all(expectedRolloverGroups().flatMap((key: string) => freshS2PlanData.groups[key] || []).map((team: any) => db.collection('players_v14').doc(String(team.id)).get())),
    ]);
    const plan = freshS2PlanData;
    const built = buildSeasonTwoRecoveryDocuments(plan, seasonStart);
    const expectedMatchIds = new Set(built.matches.map(item => item.id));
    const matchById = new Map(matchesSnap.docs.map((doc: any) => [doc.id, doc]));
    const missingProfiles = profileSnaps.filter((snap: any) => !snap.exists).map((snap: any) => snap.id);
    if (missingProfiles.length) return { success: false, reason: 'SEASON_2_TEAM_PROFILE_MISSING', ids: missingProfiles.slice(0, 20), writesStarted: false };
    if (matchesSnap.docs.some((doc: any) => !expectedMatchIds.has(doc.id) && String((doc.data() || {}).type || 'league').toLowerCase() === 'league')) {
      return { success: false, reason: 'UNEXPECTED_SEASON_2_LEAGUE_MATCH', writesStarted: false };
    }

    for (const expected of built.matches) {
      const existing: any = matchById.get(expected.id);
      if (!existing) continue;
      const data = existing.data() || {};
      const expectedData = expected.data;
      if (Number(data.season) !== 2 || Number(data.level) !== expectedData.level || Number(data.groupId) !== expectedData.groupId ||
          Number(data.tour || data.day) !== Number(expectedData.tour) || String(data.homeId) !== String(expectedData.homeId) ||
          String(data.awayId) !== String(expectedData.awayId) || Number(data.homeRank) !== Number(expectedData.homeRank) ||
          Number(data.awayRank) !== Number(expectedData.awayRank)) {
        return { success: false, reason: 'SEASON_2_EXISTING_MATCH_CONFLICT', matchId: expected.id, writesStarted: false };
      }
      if ((data.isFinished === true || String(data.status || '').toLowerCase() === 'finished') && !isValidSeasonTwoRecoveryResult(data)) {
        return { success: false, reason: 'SEASON_2_SAVED_RESULT_INVALID', matchId: expected.id, writesStarted: false };
      }
      if ((data.isProcessing === true || String(data.status || '').toLowerCase() === 'processing') && !isValidSeasonTwoRecoveryResult(data)) {
        const processingAt = timestampToMillis(data.processingStartedAt);
        const scheduledAt = timestampToMillis(data.startTime || data.scheduledStartAt);
        const stale = Number.isFinite(processingAt) ? Date.now() - processingAt >= 15 * 60 * 1000 : Number.isFinite(scheduledAt) && Date.now() - scheduledAt >= 2 * 60 * 60 * 1000;
        if (!stale) return { success: false, reason: 'SEASON_2_MATCH_CURRENTLY_PROCESSING', matchId: expected.id, writesStarted: false };
      }
    }

    const profileById = new Map(profileSnaps.map((snap: any) => [snap.id, snap.data() || {}]));
    for (const expected of built.matches) {
      const existing: any = matchById.get(expected.id);
      if (existing && isValidSeasonTwoRecoveryResult(existing.data() || {})) continue;
      const match = expected.data;
      const homeProfile: any = profileById.get(String(match.homeId)) || {};
      const awayProfile: any = profileById.get(String(match.awayId)) || {};
      const simulation = runMatchEngine({
      mode: 'league',
        matchId: expected.id,
        teamA: buildMatchTeamSnapshot(homeProfile, match.homeName, String(match.homeId), 'league'),
        teamB: buildMatchTeamSnapshot(awayProfile, match.awayName, String(match.awayId), 'league'),
        bestOf: 2,
      });
      const [homeScore, awayScore] = String(simulation.seriesScore || '').split('-').map(Number);
      if (![homeScore, awayScore].every(Number.isInteger) || homeScore < 0 || homeScore > 2 || awayScore < 0 || awayScore > 2 || homeScore + awayScore === 0) {
        return { success: false, reason: 'SEASON_2_ENGINE_RESULT_PREFLIGHT_FAILED', matchId: expected.id, writesStarted: false };
      }
    }

    const existingTableById = new Map(tablesSnap.docs.map((doc: any) => [doc.id, doc]));
    const existingSlotById = new Map(slotsSnap.docs.map((doc: any) => [doc.id, doc]));
    for (const expected of built.tables) {
      const existing: any = existingTableById.get(expected.id);
      if (!existing) continue;
      const data = existing.data() || {};
      const ids = Object.keys(data.stats || {}).sort();
      if (Number(data.season) !== 2 || ids.length !== 8 || ids.sort().join('|') !== Object.keys(expected.data.stats).sort().join('|')) {
        return { success: false, reason: 'SEASON_2_EXISTING_TABLE_CONFLICT', tableId: expected.id, writesStarted: false };
      }
    }
    for (const expected of built.slots) {
      const existing: any = existingSlotById.get(expected.id);
      if (!existing) continue;
      const data = existing.data() || {};
      if (Number(data.season) !== 2 || Number(data.division ?? data.level) !== Number(expected.data.division) ||
          Number(data.group) !== Number(expected.data.group) || Number(data.rank) !== Number(expected.data.rank) ||
          String(data.occupantId || '') !== String(expected.data.occupantId || '')) {
        return { success: false, reason: 'SEASON_2_EXISTING_SLOT_CONFLICT', slotId: expected.id, writesStarted: false };
      }
    }

    const archiveChildrenSnap = await archiveRef.collection('matches').get();
    const archivedById = new Map(archiveChildrenSnap.docs.map((doc: any) => [doc.id, doc.data() || {}]));
    if (archiveChildrenSnap.docs.some((doc: any) => !expectedMatchIds.has(doc.id))) {
      return { success: false, reason: 'SEASON_2_ARCHIVE_CONTAINS_UNEXPECTED_MATCH', writesStarted: false };
    }

    const pendingWrites: Array<{ ref: any; data: any; options?: any }> = [];
    const addMissing = (collection: string, expectedDocs: SeasonTwoRecoveryDocument[], present: Map<string, any>) => {
      for (const item of expectedDocs) if (!present.has(item.id)) pendingWrites.push({ ref: db.collection(collection).doc(item.id), data: item.data });
    };
    addMissing('league_tables_v2', built.tables, existingTableById);
    addMissing('league_slots_v1', built.slots, existingSlotById);
    addMissing('matches_v2', built.matches, matchById);
    for (let offset = 0; offset < pendingWrites.length; offset += 400) {
      await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
      await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, pendingWrites.slice(offset, offset + 400));
      writesStarted = true;
    }

    const [freshTables, freshSlots, freshMatches] = await Promise.all([
      db.collection('league_tables_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 2).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 2).where('version', '==', 140).get(),
    ]);
    const leagueMatches = freshMatches.docs.filter((doc: any) => String((doc.data() || {}).type || 'league').toLowerCase() === 'league');
    const canonicalCheck = evaluateCanonicalDocuments({ tables: freshTables.docs, slots: freshSlots.docs, matches: leagueMatches });
    if (!canonicalCheck.ready || leagueMatches.length !== 840) {
      return { success: false, reason: 'SEASON_2_CANONICAL_STRUCTURE_INVALID', diagnostics: canonicalCheck.reasons, writesStarted };
    }

    const unresolved = leagueMatches.filter((doc: any) => !isValidSeasonTwoRecoveryResult(doc.data() || {}));
    let simulationErrors: Array<{ matchId: string; error: string }> = [];
    await runWithConcurrency(unresolved, 5, async (doc: any) => {
      try {
        const result = await resolveUniversalMatchDocument(doc.id, { requireDue: true, rolloverLock: { ownerId: lock.ownerId, token: lock.token } });
        if (result.finished !== true) throw new Error(result.status || 'SEASON_2_MATCH_NOT_DUE');
        writesStarted = true;
      } catch (error: any) {
        simulationErrors.push({ matchId: doc.id, error: String(error?.message || 'MATCH_RESOLUTION_FAILED') });
      }
    });
    if (simulationErrors.length) return { success: false, reason: 'SEASON_2_MATCH_SIMULATION_PARTIAL', errors: simulationErrors.slice(0, 20), simulatedMatches: unresolved.length - simulationErrors.length, writesStarted };

    const standingsSync = await rebuildLeagueTablesFromFinishedMatches(db, 2);
    if (!standingsSync.success || standingsSync.finishedMatches !== 840) {
      return { success: false, reason: 'SEASON_2_STANDINGS_REBUILD_FAILED', diagnostics: standingsSync.diagnostics, writesStarted: true };
    }

    const [finalTablesSnap, finalMatchesSnap, finalArchiveChildren] = await Promise.all([
      db.collection('league_tables_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
      db.collection('matches_v2').where('season', '==', 2).where('version', '==', 140).get(),
      archiveRef.collection('matches').get(),
    ]);
    const finalMatches = finalMatchesSnap.docs.filter((doc: any) => String((doc.data() || {}).type || 'league').toLowerCase() === 'league');
    if (finalMatches.length !== 840 || finalMatches.some((doc: any) => !isValidSeasonTwoRecoveryResult(doc.data() || {}))) {
      return { success: false, reason: 'SEASON_2_FINAL_RESULTS_INCOMPLETE', finishedMatches: finalMatches.filter((doc: any) => isValidSeasonTwoRecoveryResult(doc.data() || {})).length, writesStarted: true };
    }
    const matchArchive: any[] = [];
    const fixturesByGroup = new Map<string, any[]>();
    for (const doc of finalMatches) {
      const m = doc.data() || {};
      const level = Number(m.level);
      const group = Number(m.groupId);
      const score = { home: Number(m.seriesScore?.home ?? m.scoreA), away: Number(m.seriesScore?.away ?? m.scoreB) };
      const fixture = { ...m, scoreA: score.home, scoreB: score.away, homeRank: Number(m.homeRank), awayRank: Number(m.awayRank) };
      const groupKey = `D${level}-G${group}`;
      if (!fixturesByGroup.has(groupKey)) fixturesByGroup.set(groupKey, []);
      fixturesByGroup.get(groupKey)!.push(fixture);
      matchArchive.push({
        matchId: doc.id, sourceSeason: 2, version: 140, level, group,
        tour: Number(m.tour || m.day), homeRank: Number(m.homeRank), awayRank: Number(m.awayRank),
        homeId: String(m.homeId), homeName: String(m.homeName || m.homeId),
        awayId: String(m.awayId), awayName: String(m.awayName || m.awayId),
        score, status: 'finished', isFinished: true, resolvedAt: m.resolvedAt || null,
        engineVersion: m.engineVersion || m.sportingEngine || null,
        homeStrength: m.homeStrength ?? m.sportingStrength?.home ?? null,
        awayStrength: m.awayStrength ?? m.sportingStrength?.away ?? null,
      });
    }
    if (new Set(matchArchive.map(match => match.matchId)).size !== 840 || new Set(matchArchive.map(match => `${match.level}-${match.group}-${match.homeRank}-${match.awayRank}`)).size !== 840) {
      return { success: false, reason: 'SEASON_2_FINAL_FIXTURE_DUPLICATE', writesStarted: true };
    }

    const standings: Record<string, any[]> = {};
    for (const key of expectedRolloverGroups()) {
      const fixtures = fixturesByGroup.get(key) || [];
      const rows = calculateGroupStandings({}, fixtures, 8);
      if (fixtures.length !== 56 || rows.length !== 8) return { success: false, reason: 'SEASON_2_GROUP_STANDINGS_INVALID', group: key, writesStarted: true };
      standings[key] = rows.map((row: any, index: number) => ({ ...row, rank: index + 1 }));
    }
    const expectedArchiveIds = new Set(matchArchive.map(match => match.matchId));
    for (const doc of finalArchiveChildren.docs) {
      if (!expectedArchiveIds.has(doc.id)) return { success: false, reason: 'SEASON_2_ARCHIVE_MATCH_CONFLICT', matchId: doc.id, writesStarted: true };
      const source: any = matchArchive.find(match => match.matchId === doc.id);
      const saved: any = doc.data() || {};
      if (!source || Number(saved.score?.home) !== source.score.home || Number(saved.score?.away) !== source.score.away ||
          String(saved.homeId) !== source.homeId || String(saved.awayId) !== source.awayId || saved.isFinished !== true) {
        return { success: false, reason: 'SEASON_2_ARCHIVE_RESULT_CONFLICT', matchId: doc.id, writesStarted: true };
      }
    }
    const missingArchiveWrites = matchArchive.filter(match => !finalArchiveChildren.docs.some((doc: any) => doc.id === match.matchId))
      .map(match => ({ ref: archiveRef.collection('matches').doc(match.matchId), data: { ...match, archivedAt: FieldValue.serverTimestamp() } }));
    for (let offset = 0; offset < missingArchiveWrites.length; offset += 400) {
      await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
      await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, missingArchiveWrites.slice(offset, offset + 400));
      writesStarted = true;
    }

    const priorRecovery = latestArchive.recovery || {};
    await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{ ref: archiveRef, data: {
      sourceSeason: 2,
      leagueId: 'ALPHA',
      archiveVersion: 1,
      status: 'preparing',
      expectedMatches: 840,
      finishedMatches: 840,
      unresolvedMatches: 0,
      groups: 15,
      teamCount: 120,
      standings,
      finalizedAt: FieldValue.serverTimestamp(),
      completionMode: 'late_engine_reconstruction',
      reconstruction: { method: 'shared-match-engine', engineVersion: 'simulateMatchCore', simulatedMatches: unresolved.length, preservedPriorResults: 840 - unresolved.length, historicalRosterSnapshotAvailable: false, rosterSource: 'saved player profiles at recovery time' },
      recovery: { ...priorRecovery, status: 'completed', finalStandingsAvailable: true, reason: 'MISSING_SEASON_2_FIXTURES_RECONSTRUCTED_WITH_SHARED_ENGINE' },
      integrity: { complete: true, recovery: true, reconstructed: true, unfinishedMatches: 0, invalidResults: 0, canonicalMatches: 840, duplicateCanonicalFixtures: 0 },
      updatedAt: FieldValue.serverTimestamp(),
    }, options: { merge: true } }]);
    writesStarted = true;

    const [preparedArchiveSnap, preparedChildrenSnap, s3PlanLatest] = await Promise.all([
      archiveRef.get(), archiveRef.collection('matches').get(), db.doc('league_season_rollovers_v1/S3').get(),
    ]);
    const preparedArchive = preparedArchiveSnap.data() || {};
    const preparedChildren = preparedChildrenSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    if (preparedChildren.length !== 840 || !isSeasonArchiveReadyToComplete(preparedArchive, preparedChildren, s3PlanLatest.data() || {})) {
      const snapshot = validateSeasonArchiveSnapshot(preparedArchive, preparedChildren);
      return { success: false, reason: 'SEASON_2_ARCHIVE_VALIDATION_FAILED', diagnostics: snapshot.reasons, archiveMatches: preparedChildren.length, writesStarted: true };
    }
    await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, [{ ref: archiveRef, data: { status: 'completed', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, options: { merge: true } }]);
    const finalArchiveSnap = await archiveRef.get();
    const finalChildrenSnap = await archiveRef.collection('matches').get();
    const finalArchiveData = finalArchiveSnap.data() || {};
    const finalArchiveRecords = finalChildrenSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const finalValidation = validateSeasonArchiveSnapshot(finalArchiveData, finalArchiveRecords);
    const finalConfig = (await configRef.get()).data() || {};
    if (finalArchiveData.status !== 'completed' || !finalValidation.valid || Number(finalConfig.activeSeasonNumber) !== 3 ||
        finalConfig.seasonStart !== config.seasonStart || finalConfig.nextSeasonStart !== config.nextSeasonStart) {
      return { success: false, reason: 'SEASON_2_FINAL_PUBLISH_CHECK_FAILED', diagnostics: finalValidation.reasons, writesStarted: true };
    }
    return { success: true, season: 2, archiveStatus: 'completed', expectedMatches: 840, finishedMatches: 840, preservedResults: 840 - unresolved.length, simulatedMatches: unresolved.length, groups: 15, teams: 120, standingsValidated: true, activeSeasonNumber: 3, season3DatesPreserved: true };
  } finally {
    await releaseSeasonRolloverLock(db, lock.ownerId, lock.token);
  }
}

/** Reconstruct and close the already-active S3 without publishing future S4. */
async function reconstructAndCloseActiveSeasonThree() {
  const db = getAdminDb();
  const configRef = db.doc('system_v1/season_config');
  const s2ArchiveRef = db.doc('league_season_archives_v1/S2');
  const s3ArchiveRef = db.doc('league_season_archives_v1/S3');
  const s3PlanRef = db.doc('league_season_rollovers_v1/S3');
  const [configSnap, s2ArchiveSnap, s2ArchiveMatchesSnap, s3PlanSnap, s3ArchiveSnap,
    tablesSnap, slotsSnap, matchesSnap] = await Promise.all([
    configRef.get(), s2ArchiveRef.get(), s2ArchiveRef.collection('matches').get(), s3PlanRef.get(), s3ArchiveRef.get(),
    db.collection('league_tables_v2').where('season', '==', 3).get(),
    db.collection('league_slots_v1').where('season', '==', 3).get(),
    db.collection('matches_v2').where('season', '==', 3).get(),
  ]);
  const config = configSnap.data() || {};
  const s2Archive = s2ArchiveSnap.data() || {};
  const s2Matches = s2ArchiveMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const s3Plan = s3PlanSnap.data() || {};
  if (!configSnap.exists || Number(config.activeSeasonNumber) !== 3 || config.phase !== 'REGULAR_SEASON' ||
      config.worldReady !== true || config.seasonStart !== S3_START_ISO || config.nextSeasonStart !== S4_START_ISO ||
      !isCompletedSeasonArchive(s2Archive) || !validateSeasonArchiveSnapshot(s2Archive, s2Matches).valid ||
      !validateRolloverPlan(s3Plan, 2, 3).valid) {
    return { success: false, reason: 'S3_RECONSTRUCTION_CONFIG_OR_S2_PLAN_INVALID', writesStarted: false };
  }

  if (s3ArchiveSnap.exists && s3ArchiveSnap.data()?.status === 'completed') {
    const [archiveChildrenSnap, s4PlanSnap] = await Promise.all([
      s3ArchiveRef.collection('matches').get(), db.doc('league_season_rollovers_v1/S4').get(),
    ]);
    const archive = s3ArchiveSnap.data() || {};
    const children = archiveChildrenSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const validation = validateSeasonArchiveSnapshot(archive, children);
    if (!validation.valid || !validateRolloverPlan(s4PlanSnap.data(), 3, 4).valid) {
      return { success: false, reason: 'COMPLETED_S3_ARCHIVE_OR_S4_PLAN_INVALID', diagnostics: validation.reasons, writesStarted: false };
    }
    return { success: true, alreadyCompleted: true, season: 3, archiveStatus: 'completed', activeSeasonNumber: 3, nextSeason4Start: S4_START_ISO, writesStarted: false };
  }

  const existingLeagueMatches = matchesSnap.docs.filter((doc: any) => {
    const data = doc.data() || {};
    return String(data.type || data.matchType || 'league').toLowerCase() === 'league';
  });
  const built = buildSeasonRecoveryDocuments(s3Plan, 2, 3, new Date(S3_START_ISO));
  const expectedTables = new Map(built.tables.map(item => [item.id, item]));
  const expectedSlots = new Map(built.slots.map(item => [item.id, item]));
  const expectedMatches = new Map(built.matches.map(item => [item.id, item]));
  if ((s3ArchiveSnap.exists && !['preparing', 'completed'].includes(String(s3ArchiveSnap.data()?.status || ''))) ||
      tablesSnap.docs.some((doc: any) => !expectedTables.has(doc.id)) ||
      slotsSnap.docs.some((doc: any) => !expectedSlots.has(doc.id)) ||
      existingLeagueMatches.some((doc: any) => !expectedMatches.has(doc.id))) {
    return { success: false, reason: 'S3_PARTIAL_STATE_REQUIRES_REVIEW', writesStarted: false };
  }
  for (const doc of existingLeagueMatches) {
    const data = doc.data() || {};
    const expected: any = expectedMatches.get(doc.id);
    if (Number(data.season) !== 3 || Number(data.level) !== Number(expected.data.level) ||
        Number(data.groupId) !== Number(expected.data.groupId) || Number(data.homeRank) !== Number(expected.data.homeRank) ||
        Number(data.awayRank) !== Number(expected.data.awayRank) || String(data.homeId) !== String(expected.data.homeId) ||
        String(data.awayId) !== String(expected.data.awayId) ||
        ((data.isFinished === true || String(data.status || '').toLowerCase() === 'finished') && !isValidSeasonTwoRecoveryResult(data))) {
      return { success: false, reason: 'S3_EXISTING_MATCH_CONFLICT', matchId: doc.id, writesStarted: false };
    }
  }

  const participantIds = [...new Set(built.matches.flatMap(item => [String(item.data.homeId), String(item.data.awayId)]))];
  const profiles = await Promise.all(participantIds.map(id => db.collection('players_v14').doc(id).get()));
  const missingProfiles = profiles.filter((snap: any) => !snap.exists).map((snap: any) => snap.id);
  if (missingProfiles.length) return { success: false, reason: 'S3_PARTICIPANT_PROFILE_MISSING', ids: missingProfiles.slice(0, 20), writesStarted: false };
  const profileById = new Map(profiles.map((snap: any) => [snap.id, snap.data() || {}]));
  const existingMatchById = new Map(existingLeagueMatches.map((doc: any) => [doc.id, doc]));
  const simulationPreflight = built.matches.filter((item: any) => {
    const existing: any = existingMatchById.get(item.id);
    return !existing || !isValidSeasonTwoRecoveryResult(existing.data() || {});
  }).slice(0, RECOVERY_MATCH_BATCH_SIZE);
  for (const item of simulationPreflight) {
    const match = item.data;
    const result = runMatchEngine({
      mode: 'league',
      matchId: item.id,
      teamA: buildMatchTeamSnapshot(profileById.get(String(match.homeId)) || {}, match.homeName, String(match.homeId), 'league'),
      teamB: buildMatchTeamSnapshot(profileById.get(String(match.awayId)) || {}, match.awayName, String(match.awayId), 'league'),
      bestOf: 2,
    });
    const [home, away] = String(result.seriesScore || '').split('-').map(Number);
    if (!isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA: home, scoreB: away })) {
      return { success: false, reason: 'S3_SIMULATION_PREFLIGHT_FAILED', matchId: item.id, writesStarted: false };
    }
  }

  const lock = await acquireSeasonRolloverLock(db, 3, 4);
  if (!lock.acquired) return { success: false, reason: 'SEASON_ROLLOVER_LOCKED', writesStarted: false };
  let writesStarted = false;
  try {
    await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
    const [freshConfig, freshS2Archive, freshS2Children, freshPlan, freshArchive, freshTables, freshSlots, freshMatches] = await Promise.all([
      configRef.get(), s2ArchiveRef.get(), s2ArchiveRef.collection('matches').get(), s3PlanRef.get(), s3ArchiveRef.get(),
      db.collection('league_tables_v2').where('season', '==', 3).get(),
      db.collection('league_slots_v1').where('season', '==', 3).get(),
      db.collection('matches_v2').where('season', '==', 3).get(),
    ]);
    const latestConfig = freshConfig.data() || {};
    const latestS2 = freshS2Archive.data() || {};
    const latestS2Matches = freshS2Children.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const latestMatches = freshMatches.docs.filter((doc: any) => String((doc.data() || {}).type || (doc.data() || {}).matchType || 'league').toLowerCase() === 'league');
    if (Number(latestConfig.activeSeasonNumber) !== 3 || latestConfig.worldReady !== true ||
        latestConfig.seasonStart !== S3_START_ISO || latestConfig.nextSeasonStart !== S4_START_ISO ||
        !isCompletedSeasonArchive(latestS2) || !validateSeasonArchiveSnapshot(latestS2, latestS2Matches).valid ||
        !validateRolloverPlan(freshPlan.data(), 2, 3).valid ||
        (freshArchive.exists && !['preparing', 'completed'].includes(String(freshArchive.data()?.status || '')))) {
      return { success: false, reason: 'S3_RECONSTRUCTION_STATE_CHANGED', writesStarted: false };
    }
    const freshTableIds = new Set(freshTables.docs.map((doc: any) => doc.id));
    const freshSlotIds = new Set(freshSlots.docs.map((doc: any) => doc.id));
    const freshMatchIds = new Set(latestMatches.map((doc: any) => doc.id));
    const worldWrites = [
      ...built.tables.filter(item => !freshTableIds.has(item.id)).map(item => ({ ref: db.collection('league_tables_v2').doc(item.id), data: item.data })),
      ...built.slots.filter(item => !freshSlotIds.has(item.id)).map(item => ({ ref: db.collection('league_slots_v1').doc(item.id), data: item.data })),
      ...built.matches.filter(item => !freshMatchIds.has(item.id)).map(item => ({ ref: db.collection('matches_v2').doc(item.id), data: item.data })),
    ];
    for (let offset = 0; offset < worldWrites.length; offset += 400) {
      await assertSeasonRolloverLock(db, lock.ownerId, lock.token);
      await commitSeasonRolloverWrites(db, lock.ownerId, lock.token, worldWrites.slice(offset, offset + 400));
      writesStarted = true;
    }
    const [tables, slots, fixtures] = await Promise.all([
      db.collection('league_tables_v2').where('season', '==', 3).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 3).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 3).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
    ]);
    const readiness = evaluateCanonicalDocuments({ tables: tables.docs, slots: slots.docs, matches: fixtures.docs });
    if (!readiness.ready || fixtures.size !== 840) return { success: false, reason: 'S3_CANONICAL_WORLD_INVALID', diagnostics: readiness.reasons, writesStarted };
    const errors: any[] = [];
    const unresolved = fixtures.docs.filter((doc: any) => !isValidSeasonTwoRecoveryResult(doc.data() || {}));
    const batch = unresolved.slice(0, RECOVERY_MATCH_BATCH_SIZE);
    await runWithConcurrency(batch, 1, async (doc: any) => {
      try {
        const result = await resolveUniversalMatchDocument(doc.id, { rolloverLock: { ownerId: lock.ownerId, token: lock.token } });
        if (result.finished !== true) throw new Error(result.status || 'S3_MATCH_NOT_FINISHED');
      } catch (error: any) {
        errors.push({ matchId: doc.id, error: String(error?.message || 'S3_MATCH_RESOLUTION_FAILED') });
      }
    });
    if (errors.length) return { success: false, reason: 'S3_SIMULATION_PARTIAL', errors: errors.slice(0, 20), writesStarted: true };
    if (unresolved.length > batch.length) {
      return { success: true, complete: false, stage: 'S3_MATCH_RECONSTRUCTION', resolvedThisRun: batch.length,
        remainingMatches: unresolved.length - batch.length, writesStarted: true };
    }
    writesStarted = true;
  } finally {
    await releaseSeasonRolloverLock(db, lock.ownerId, lock.token);
  }

  const standings = await rebuildLeagueTablesFromFinishedMatches(db, 3);
  if (!standings.success || standings.finishedMatches !== 840) {
    return { success: false, reason: 'S3_STANDINGS_REBUILD_FAILED', diagnostics: standings.diagnostics, writesStarted: true };
  }
  const rollover = await prepareSeasonRollover(db, 3, 4);
  if (!rollover.ready) return { success: false, reason: 'S3_ROLLOVER_BLOCKED', rollover, writesStarted: true };
  const [archiveSnap, archiveMatchesSnap, s4PlanSnap] = await Promise.all([
    s3ArchiveRef.get(), s3ArchiveRef.collection('matches').get(), db.doc('league_season_rollovers_v1/S4').get(),
  ]);
  const archive = archiveSnap.data() || {};
  const archiveMatches = archiveMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  if (!isCompletedSeasonArchive(archive) || !validateSeasonArchiveSnapshot(archive, archiveMatches).valid ||
      !validateRolloverPlan(s4PlanSnap.data(), 3, 4).valid) {
    return { success: false, reason: 'S3_ARCHIVE_OR_S4_PLAN_INVALID', writesStarted: true };
  }
  await s3ArchiveRef.set({
    completionMode: 'late_engine_reconstruction',
    reconstruction: { method: 'shared-match-engine', engineVersion: 'simulateMatchCore', simulatedMatches: 840,
      preservedPriorResults: 0, historicalRosterSnapshotAvailable: false,
      rosterSource: 'saved player profiles at recovery time', reconstructedAt: FieldValue.serverTimestamp() },
    integrity: { ...(archive.integrity || {}), reconstructed: true },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { success: true, season: 3, archiveStatus: 'completed', finishedMatches: 840,
    simulatedMatches: 840, preservedResults: 0, s4PlanReady: true,
    activeSeasonNumber: 3, nextSeason4Start: S4_START_ISO, writesStarted: true };
}

/**
 * Reconstruct an entirely missing historical S2 from the validated S1→S2
 * placements. Every generated result is explicitly marked as reconstructed;
 * the ordinary rollover then owns standings, awards, and the S2→S3 plan.
 */
export async function reconstructMissingSeasonTwoAndPrepareSeasonThree() {
  const db = getAdminDb();
  const configRef = db.doc('system_v1/season_config');
  const s1ArchiveRef = db.doc('league_season_archives_v1/S1');
  const s1MatchesRef = s1ArchiveRef.collection('matches');
  const s2PlanRef = db.doc('league_season_rollovers_v1/S2');
  const s2ArchiveRef = db.doc('league_season_archives_v1/S2');

  const [configSnap, s1ArchiveSnap, s1MatchesSnap, s2PlanSnap, s2ArchiveSnap, s2Tables, s2Slots, s2Matches] = await Promise.all([
    configRef.get(), s1ArchiveRef.get(), s1MatchesRef.get(), s2PlanRef.get(), s2ArchiveRef.get(),
    db.collection('league_tables_v2').where('season', '==', 2).get(),
    db.collection('league_slots_v1').where('season', '==', 2).get(),
    db.collection('matches_v2').where('season', '==', 2).get(),
  ]);
  const config = configSnap.exists ? configSnap.data() || {} : {};
  const s1Archive = s1ArchiveSnap.data() || {};
  const s1Matches = s1MatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const s2Plan = s2PlanSnap.data() || {};
  const activeSeason = Number(config.activeSeasonNumber);
  const allowedS1RecoveryPhase = ['REGULAR_SEASON', 'GENERATING_NEXT', 'WORLD_BUILDING'].includes(String(config.phase || ''));
  const s2PreparationInProgress = Number(config.nextSeasonNumber || config.preparationTargetSeason || 0) === 2 &&
    (config.worldReady === false || config.phase !== 'REGULAR_SEASON');
  const validS1State = activeSeason === 1 && allowedS1RecoveryPhase &&
    (config.worldReady === true || s2PreparationInProgress) &&
    config.seasonStart === '2026-09-21T15:00:00.000Z' && config.nextSeasonStart === '2026-10-08T15:00:00.000Z';
  const validS2State = activeSeason === 2 && config.phase === 'REGULAR_SEASON' && config.worldReady === true &&
    config.seasonStart === S2_START_ISO && config.nextSeasonStart === S3_START_ISO;
  const validS3State = activeSeason === 3 && config.phase === 'REGULAR_SEASON' && config.worldReady === true &&
    config.seasonStart === S3_START_ISO && config.nextSeasonStart === S4_START_ISO;
  if (!configSnap.exists || (!validS1State && !validS2State && !validS3State)) {
    return { success: false, reason: 'S1_CONFIG_MISMATCH', writesStarted: false };
  }
  if (!isCompletedSeasonArchive(s1Archive) || !validateSeasonArchiveSnapshot(s1Archive, s1Matches).valid ||
      !validateRolloverPlan(s2Plan, 1, 2).valid) {
    return { success: false, reason: 'S1_ARCHIVE_OR_S2_PLAN_INVALID', writesStarted: false };
  }
  if (validS3State) {
    const [s2ArchiveSnap, s2ArchiveMatches, s3PlanSnap, s3ArchiveSnap] = await Promise.all([
      db.doc('league_season_archives_v1/S2').get(),
      db.collection('league_season_archives_v1/S2/matches').get(),
      db.doc('league_season_rollovers_v1/S3').get(),
      db.doc('league_season_archives_v1/S3').get(),
    ]);
    const archive = s2ArchiveSnap.data() || {};
    const matches = s2ArchiveMatches.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    if (!isCompletedSeasonArchive(archive) || !validateSeasonArchiveSnapshot(archive, matches).valid ||
        !validateRolloverPlan(s3PlanSnap.data(), 2, 3).valid) {
      return { success: false, reason: 'ACTIVE_S3_RECOVERY_STATE_INVALID', writesStarted: false };
    }
    return await reconstructAndCloseActiveSeasonThree();
  }
  if (validS2State) {
    const [s2ArchiveSnap, s2ArchiveMatchesSnap, s3PlanSnap] = await Promise.all([
      s2ArchiveRef.get(), s2ArchiveRef.collection('matches').get(), db.doc('league_season_rollovers_v1/S3').get(),
    ]);
    const s2Archive = s2ArchiveSnap.data() || {};
    const s2ArchiveMatches = s2ArchiveMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    if (!isCompletedSeasonArchive(s2Archive) || !validateSeasonArchiveSnapshot(s2Archive, s2ArchiveMatches).valid ||
        !validateRolloverPlan(s3PlanSnap.data(), 2, 3).valid ||
        s2Archive.reconstruction?.method !== 'shared-match-engine') {
      return { success: false, reason: 'ACTIVE_S2_RECOVERY_STATE_INVALID', writesStarted: false };
    }
  }

  const built = buildSeasonTwoRecoveryDocuments(s2Plan, new Date(FIRST_SEASON_NEXT_START_ISO));
  const expectedTableById = new Map(built.tables.map((item: any) => [item.id, item]));
  const expectedSlotById = new Map(built.slots.map((item: any) => [item.id, item]));
  const expectedMatchById = new Map(built.matches.map((item: any) => [item.id, item]));
  const existingLeagueMatches = s2Matches.docs.filter((doc: any) => {
    const data = doc.data() || {};
    return String(data.type || data.matchType || 'league').toLowerCase() === 'league';
  });
  const existingMatchById = new Map(existingLeagueMatches.map((doc: any) => [doc.id, doc]));
  if (s2ArchiveSnap.exists && !['preparing', 'completed'].includes(String(s2ArchiveSnap.data()?.status || ''))) {
    return { success: false, reason: 'S2_PARTIAL_ARCHIVE_REQUIRES_REVIEW', writesStarted: false };
  }
  if (s2Tables.docs.some((doc: any) => !expectedTableById.has(doc.id)) ||
      s2Slots.docs.some((doc: any) => !expectedSlotById.has(doc.id)) ||
      existingLeagueMatches.some((doc: any) => !expectedMatchById.has(doc.id))) {
    return { success: false, reason: 'S2_UNEXPECTED_PARTIAL_DOCUMENTS', writesStarted: false };
  }
  for (const doc of s2Tables.docs) {
    const data = doc.data() || {};
    const expected: any = expectedTableById.get(doc.id);
    const actualIds = Object.keys(data.stats || {}).sort();
    const expectedIds = Object.keys(expected.data.stats).sort();
    if (Number(data.season) !== 2 || actualIds.join('|') !== expectedIds.join('|') ||
        Number(data.level) !== Number(expected.data.level) || Number(data.group) !== Number(expected.data.group)) {
      return { success: false, reason: 'S2_EXISTING_TABLE_CONFLICT', tableId: doc.id, writesStarted: false };
    }
  }
  for (const doc of s2Slots.docs) {
    const data = doc.data() || {};
    const expected: any = expectedSlotById.get(doc.id);
    if (Number(data.season) !== 2 || Number(data.division ?? data.level) !== Number(expected.data.division) ||
        Number(data.group) !== Number(expected.data.group) || Number(data.rank) !== Number(expected.data.rank) ||
        String(data.occupantId || '') !== String(expected.data.occupantId || '')) {
      return { success: false, reason: 'S2_EXISTING_SLOT_CONFLICT', slotId: doc.id, writesStarted: false };
    }
  }
  for (const doc of existingLeagueMatches) {
    const data = doc.data() || {};
    const expected: any = expectedMatchById.get(doc.id);
    if (Number(data.season) !== 2 || Number(data.level) !== Number(expected.data.level) ||
        Number(data.groupId) !== Number(expected.data.groupId) || Number(data.homeRank) !== Number(expected.data.homeRank) ||
        Number(data.awayRank) !== Number(expected.data.awayRank) || String(data.homeId) !== String(expected.data.homeId) ||
        String(data.awayId) !== String(expected.data.awayId)) {
      return { success: false, reason: 'S2_EXISTING_MATCH_CONFLICT', matchId: doc.id, writesStarted: false };
    }
    if ((data.isFinished === true || String(data.status || '').toLowerCase() === 'finished') && !isValidSeasonTwoRecoveryResult(data)) {
      return { success: false, reason: 'S2_EXISTING_RESULT_INVALID', matchId: doc.id, writesStarted: false };
    }
  }
  const allParticipantIds = [...new Set(built.matches.flatMap((item: any) => [String(item.data.homeId), String(item.data.awayId)]))];
  const profiles = await Promise.all(allParticipantIds.map(id => db.collection('players_v14').doc(id).get()));
  const missingProfiles = validS1State ? profiles.filter((snap: any) => !snap.exists).map((snap: any) => snap.id) : [];
  if (missingProfiles.length) return { success: false, reason: 'S2_PARTICIPANT_PROFILE_MISSING', ids: missingProfiles, writesStarted: false };
  const profileById = new Map(profiles.map((snap: any) => [snap.id, snap.data() || {}]));

  const simulationPreflight = validS1State
    ? built.matches.filter((item: any) => {
        const existing: any = existingMatchById.get(item.id);
        return !existing || !isValidSeasonTwoRecoveryResult(existing.data() || {});
      }).slice(0, RECOVERY_MATCH_BATCH_SIZE)
    : [];
  for (const item of simulationPreflight) {
    const match = item.data;
    const home = profileById.get(String(match.homeId)) || {};
    const away = profileById.get(String(match.awayId)) || {};
    const result = runMatchEngine({
      mode: 'league',
      matchId: item.id,
      teamA: buildMatchTeamSnapshot(home, match.homeName, String(match.homeId), 'league'),
      teamB: buildMatchTeamSnapshot(away, match.awayName, String(match.awayId), 'league'),
      bestOf: 2,
    });
    const [scoreA, scoreB] = String(result.seriesScore || '').split('-').map(Number);
    if (!isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA, scoreB })) {
      return { success: false, reason: 'S2_SIMULATION_PREFLIGHT_FAILED', matchId: item.id, writesStarted: false };
    }
  }

  const rolloverLock = validS1State ? await acquireSeasonRolloverLock(db, 2, 3) : { acquired: false } as any;
  if (validS1State && !rolloverLock.acquired) return { success: false, reason: 'SEASON_ROLLOVER_LOCKED', writesStarted: false };
  let writesStarted = false;
  try {
    if (validS1State) {
    await assertSeasonRolloverLock(db, rolloverLock.ownerId, rolloverLock.token);
    const [freshConfig, freshArchive, freshArchiveMatches, freshPlan, freshS2Archive, freshS2Tables, freshS2Slots, freshS2Matches] = await Promise.all([
      configRef.get(), s1ArchiveRef.get(), s1MatchesRef.get(), s2PlanRef.get(), s2ArchiveRef.get(),
      db.collection('league_tables_v2').where('season', '==', 2).get(),
      db.collection('league_slots_v1').where('season', '==', 2).get(),
      db.collection('matches_v2').where('season', '==', 2).get(),
    ]);
    const current = freshConfig.data() || {};
    const latestArchive = freshArchive.data() || {};
    const latestArchiveMatches = freshArchiveMatches.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
    const currentS2PreparationInProgress = Number(current.nextSeasonNumber || current.preparationTargetSeason || 0) === 2 &&
      (current.worldReady === false || current.phase !== 'REGULAR_SEASON');
    if (Number(current.activeSeasonNumber) !== 1 || !['REGULAR_SEASON', 'GENERATING_NEXT', 'WORLD_BUILDING'].includes(String(current.phase || '')) ||
        (current.worldReady !== true && !currentS2PreparationInProgress) ||
        !isCompletedSeasonArchive(latestArchive) || !validateSeasonArchiveSnapshot(latestArchive, latestArchiveMatches).valid ||
        !validateRolloverPlan(freshPlan.data(), 1, 2).valid ||
        (freshS2Archive.exists && !['preparing', 'completed'].includes(String(freshS2Archive.data()?.status || '')))) {
      return { success: false, reason: 'S2_RECONSTRUCTION_STATE_CHANGED', writesStarted: false };
    }

    const freshTableIds = new Set(freshS2Tables.docs.map((doc: any) => doc.id));
    const freshSlotIds = new Set(freshS2Slots.docs.map((doc: any) => doc.id));
    const freshLeagueMatches = freshS2Matches.docs.filter((doc: any) => String((doc.data() || {}).type || (doc.data() || {}).matchType || 'league').toLowerCase() === 'league');
    const freshMatchIds = new Set(freshLeagueMatches.map((doc: any) => doc.id));
    if (freshS2Tables.docs.some((doc: any) => !expectedTableById.has(doc.id)) ||
        freshS2Slots.docs.some((doc: any) => !expectedSlotById.has(doc.id)) ||
        freshLeagueMatches.some((doc: any) => !expectedMatchById.has(doc.id))) {
      return { success: false, reason: 'S2_FRESH_UNEXPECTED_DOCUMENTS', writesStarted: false };
    }
    for (const doc of freshS2Tables.docs) {
      const data = doc.data() || {};
      const expected: any = expectedTableById.get(doc.id);
      if (Number(data.season) !== 2 || Number(data.level) !== Number(expected.data.level) ||
          Number(data.group) !== Number(expected.data.group) ||
          Object.keys(data.stats || {}).sort().join('|') !== Object.keys(expected.data.stats).sort().join('|')) {
        return { success: false, reason: 'S2_FRESH_TABLE_CONFLICT', tableId: doc.id, writesStarted: false };
      }
    }
    for (const doc of freshS2Slots.docs) {
      const data = doc.data() || {};
      const expected: any = expectedSlotById.get(doc.id);
      if (Number(data.season) !== 2 || Number(data.division ?? data.level) !== Number(expected.data.division) ||
          Number(data.group) !== Number(expected.data.group) || Number(data.rank) !== Number(expected.data.rank) ||
          String(data.occupantId || '') !== String(expected.data.occupantId || '')) {
        return { success: false, reason: 'S2_FRESH_SLOT_CONFLICT', slotId: doc.id, writesStarted: false };
      }
    }
    for (const doc of freshLeagueMatches) {
      const data = doc.data() || {};
      const expected: any = expectedMatchById.get(doc.id);
      if (Number(data.season) !== 2 || Number(data.level) !== Number(expected.data.level) ||
          Number(data.groupId) !== Number(expected.data.groupId) || Number(data.homeRank) !== Number(expected.data.homeRank) ||
          Number(data.awayRank) !== Number(expected.data.awayRank) || String(data.homeId) !== String(expected.data.homeId) ||
          String(data.awayId) !== String(expected.data.awayId) ||
          ((data.isFinished === true || String(data.status || '').toLowerCase() === 'finished') && !isValidSeasonTwoRecoveryResult(data))) {
        return { success: false, reason: 'S2_FRESH_MATCH_CONFLICT', matchId: doc.id, writesStarted: false };
      }
    }
    const worldWrites = [
      ...built.tables.filter((item: any) => !freshTableIds.has(item.id)).map((item: any) => ({ ref: db.collection('league_tables_v2').doc(item.id), data: item.data })),
      ...built.slots.filter((item: any) => !freshSlotIds.has(item.id)).map((item: any) => ({ ref: db.collection('league_slots_v1').doc(item.id), data: item.data })),
      ...built.matches.filter((item: any) => !freshMatchIds.has(item.id)).map((item: any) => ({ ref: db.collection('matches_v2').doc(item.id), data: item.data })),
    ];
    for (let offset = 0; offset < worldWrites.length; offset += 400) {
      await assertSeasonRolloverLock(db, rolloverLock.ownerId, rolloverLock.token);
      await commitSeasonRolloverWrites(db, rolloverLock.ownerId, rolloverLock.token, worldWrites.slice(offset, offset + 400));
      writesStarted = true;
    }

    const [tablesSnap, slotsSnap, matchesSnap] = await Promise.all([
      db.collection('league_tables_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 2).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 2).where('leagueId', '==', 'ALPHA').where('version', '==', 140).get(),
    ]);
    const canonical = evaluateCanonicalDocuments({ tables: tablesSnap.docs, slots: slotsSnap.docs, matches: matchesSnap.docs });
    if (!canonical.ready || matchesSnap.size !== 840) return { success: false, reason: 'S2_CANONICAL_WORLD_INVALID', diagnostics: canonical.reasons, writesStarted };

    const unresolved = matchesSnap.docs.filter((doc: any) => !isValidSeasonTwoRecoveryResult(doc.data() || {}));
    const batch = unresolved.slice(0, RECOVERY_MATCH_BATCH_SIZE);
    const simulationErrors: Array<{ matchId: string; error: string }> = [];
    await runWithConcurrency(batch, 1, async (doc: any) => {
      try {
        const result = await resolveUniversalMatchDocument(doc.id, { rolloverLock: { ownerId: rolloverLock.ownerId, token: rolloverLock.token } });
        if (result.finished !== true) throw new Error(result.status || 'S2_MATCH_NOT_FINISHED');
      } catch (error: any) {
        simulationErrors.push({ matchId: doc.id, error: String(error?.message || 'S2_MATCH_SIMULATION_FAILED') });
      }
    });
    if (simulationErrors.length) return { success: false, reason: 'S2_SIMULATION_PARTIAL', errors: simulationErrors.slice(0, 20), writesStarted: true };
    if (unresolved.length > batch.length) {
      writesStarted = true;
      return { success: true, complete: false, stage: 'S2_MATCH_RECONSTRUCTION', resolvedThisRun: batch.length,
        remainingMatches: unresolved.length - batch.length, writesStarted: true };
    }
    }
  } finally {
    if (validS1State && rolloverLock.acquired) await releaseSeasonRolloverLock(db, rolloverLock.ownerId, rolloverLock.token);
  }

  if (validS1State) {
    const standingsSync = await rebuildLeagueTablesFromFinishedMatches(db, 2);
    if (!standingsSync.success || standingsSync.finishedMatches !== 840) {
      return { success: false, reason: 'S2_STANDINGS_REBUILD_FAILED', diagnostics: standingsSync.diagnostics, writesStarted: true };
    }
  }
  const rollover = validS1State ? await prepareSeasonRollover(db, 2, 3) : { ready: true, alreadyPrepared: true };
  if (rollover.ready !== true) return { success: false, reason: 'S2_ROLLOVER_BLOCKED', rollover, writesStarted: true };

  const archiveSnap = await s2ArchiveRef.get();
  const archiveMatchesSnap = await s2ArchiveRef.collection('matches').get();
  const archive = archiveSnap.data() || {};
  const archivedMatches = archiveMatchesSnap.docs.map((doc: any) => ({ ...doc.data(), matchId: doc.id }));
  const s3Plan = (await db.doc('league_season_rollovers_v1/S3').get()).data() || {};
  if (!isCompletedSeasonArchive(archive) || !validateSeasonArchiveSnapshot(archive, archivedMatches).valid ||
      !validateRolloverPlan(s3Plan, 2, 3).valid) {
    return { success: false, reason: 'S2_ARCHIVE_OR_S3_PLAN_INVALID', writesStarted: true };
  }
  await s2ArchiveRef.set({
    completionMode: 'late_engine_reconstruction',
    reconstruction: {
      method: 'shared-match-engine', engineVersion: 'simulateMatchCore', simulatedMatches: 840,
      preservedPriorResults: 0, historicalRosterSnapshotAvailable: false,
      rosterSource: 'saved player profiles at recovery time', reconstructedAt: FieldValue.serverTimestamp(),
    },
    integrity: { ...(archive.integrity || {}), reconstructed: true },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  let s2Calendar: any = null;
  let s2Publication: any = null;
  if (validS1State) {
    s2Calendar = await ensureSeasonCalendar(2);
    if (s2Calendar?.success !== true || s2Calendar?.seasonNumber !== 2 || s2Calendar?.prepared !== true) {
      return { success: false, reason: 'S2_CALENDAR_PREPARATION_BLOCKED', rollover, calendar: s2Calendar, writesStarted: true };
    }
    s2Publication = await publishPreparedSeason();
    if (s2Publication?.success !== true) return { success: false, reason: 'S2_PUBLICATION_BLOCKED', rollover, calendar: s2Calendar, publication: s2Publication, writesStarted: true };
  }

  const s3Calendar: any = await ensureSeasonCalendar(3);
  if (s3Calendar?.success !== true || s3Calendar?.seasonNumber !== 3 || s3Calendar?.prepared !== true) {
    return { success: false, reason: 'S3_CALENDAR_PREPARATION_BLOCKED', s2Publication, calendar: s3Calendar, writesStarted: true };
  }
  const s3Publication: any = await publishPreparedSeason();
  if (s3Publication?.success !== true) return { success: false, reason: 'S3_PUBLICATION_BLOCKED', s2Publication, calendar: s3Calendar, publication: s3Publication, writesStarted: true };
  const s3Completion = await reconstructAndCloseActiveSeasonThree();
  if (s3Completion.success !== true || s3Completion.complete === false) {
    return { ...s3Completion, s2Publication, s3Publication, writesStarted: s3Completion.writesStarted === true };
  }
  const finalConfig = (await configRef.get()).data() || {};
  return {
    success: Number(finalConfig.activeSeasonNumber) === 3 && finalConfig.worldReady === true &&
      finalConfig.seasonStart === S3_START_ISO && finalConfig.nextSeasonStart === S4_START_ISO,
    activeSeason: finalConfig.activeSeasonNumber,
    seasonStart: finalConfig.seasonStart,
    nextSeasonStart: finalConfig.nextSeasonStart,
    reconstructedSeason: 2,
    reconstructedMatches: 840,
    s2Rollover: rollover,
    s2Publication,
    s3Calendar: { success: s3Calendar.success, createdMatches: s3Calendar.createdMatches, prepared: s3Calendar.prepared },
    s3Publication,
    s3Completion,
    nextSeason4Start: S4_START_ISO,
    writesStarted: true,
  };
}

