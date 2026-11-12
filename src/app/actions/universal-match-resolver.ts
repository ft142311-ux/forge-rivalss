import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { SEASON_ROLLOVER_LOCK_ID, SEASON_ROLLOVER_LOCK_TTL_MS } from './season-rollover-lock';
import { buildMatchTeamSnapshot } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { timestampToMillis } from '@/app/lib/timestamp-utils';
import { normalizeName } from '@/app/lib/normalize-name';
import { assertMatchDocumentId } from '@/app/lib/match-id';
import { getMatchWinnerId } from '@/app/lib/match-winner';
import { getGlobalSeasonInfo } from '@/app/lib/time-utils';
import { resolveSeasonLifecycleWindow } from './season-boundary';

export type UniversalMatchResult = {
  success: boolean;
  finished: boolean;
  alreadyResolved?: boolean;
  matchId: string;
  status?: string;
};

/**
 * Universal Match Core finalizer.
 *
 * Every match type uses the same simulation/report contract. `type` only changes
 * metadata and post-match accounting; it must never create a second simulator.
 * League/tournament/cup resolvers may still perform their own economy/standings
 * work, but the sporting result and Match Overview report are written here.
 */
export async function resolveUniversalMatchDocument(
  matchId: string,
  options?: { requireDue?: boolean; collectionName?: 'matches_v2' | 'cup_matches'; rolloverLock?: { ownerId: string; token: string } }
): Promise<UniversalMatchResult> {
  assertMatchDocumentId(matchId, { rejectBackslash: true });

  const db = getAdminDb();
  const collectionName = options?.collectionName || 'matches_v2';
  const ref = db.collection(collectionName).doc(matchId);
  const now = Timestamp.now();

  return db.runTransaction(async (t: any) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error('MATCH_NOT_FOUND');
    const match: any = snap.data() || {};
    const rolloverLockRef = options?.rolloverLock
      ? db.collection('system_v1').doc(SEASON_ROLLOVER_LOCK_ID)
      : null;
    const rolloverLockSnap = rolloverLockRef ? await t.get(rolloverLockRef) : null;
    const rolloverLockData = rolloverLockSnap?.exists ? rolloverLockSnap.data() || {} : null;
    const rolloverNowMs = Date.now();
    if (options?.rolloverLock && (
      !rolloverLockData ||
      rolloverLockData.ownerId !== options.rolloverLock.ownerId ||
      rolloverLockData.token !== options.rolloverLock.token ||
      Number(rolloverLockData.expiresAtMs || 0) <= rolloverNowMs
    )) {
      throw new Error('SEASON_ROLLOVER_LOCK_LOST');
    }
    const renewRolloverLock = () => {
      if (rolloverLockRef && options?.rolloverLock) {
        t.set(rolloverLockRef, { expiresAtMs: rolloverNowMs + SEASON_ROLLOVER_LOCK_TTL_MS, renewedAtMs: rolloverNowMs }, { merge: true });
      }
    };

    if (match.isFinished === true || match.status === 'finished') {
      renewRolloverLock();
      // Repair the notification/report flags without re-simulating an already
      // finished match. This is intentionally idempotent.
      t.set(ref, {
        isFinished: true,
        status: 'finished',
        isProcessing: false,
        processingStartedAt: FieldValue.delete(),
        reportStatus: match.reportStatus || 'new',
        seen: match.seen === true ? true : false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { success: true, finished: true, alreadyResolved: true, matchId };
    }

    // The universal resolver is also callable directly, so the daily worker's
    // offseason guard alone is insufficient. Re-check the authoritative season
    // boundary inside this transaction before any league simulation or writes.
    const matchType = String(match.matchType || match.type || 'league').toLowerCase();
    if (collectionName === 'matches_v2' && matchType === 'league') {
      const configSnap = await t.get(db.collection('system_v1').doc('season_config'));
      const config = configSnap.exists ? configSnap.data() || {} : {};
      const info = getGlobalSeasonInfo(new Date());
      let lifecycle: ReturnType<typeof resolveSeasonLifecycleWindow>;
      try {
        lifecycle = resolveSeasonLifecycleWindow({
          seasonStart: config.seasonStart || info.currentSeasonStart,
          nextSeasonStart: config.nextSeasonStart || info.nextSeasonStart,
          now: new Date(),
        });
      } catch {
        throw new Error('SEASON_LIFECYCLE_WINDOW_INVALID');
      }
      if (lifecycle.leagueMatchesPaused) {
        return { success: true, finished: false, status: 'offseason', matchId };
      }
      const configuredActiveSeason = Number(config.activeSeasonNumber || info.activeSeasonNumber || 1);
      if (Number.isFinite(Number(match.season)) && Number(match.season) !== configuredActiveSeason) {
        return { success: true, finished: false, status: 'season_not_active', matchId };
      }
    }

    if (options?.requireDue) {
      const startMs = timestampToMillis(match.startTime || match.scheduledStartAt);
      if (!Number.isFinite(startMs) || startMs > now.toMillis()) {
        return { success: true, finished: false, status: 'scheduled', matchId };
      }
    }

    const homeId = match.homeId ?? match.hostId ?? match.teamAId;
    const awayId = match.awayId ?? match.challengerId ?? match.teamBId;
    if (!homeId || !awayId) throw new Error('MATCH_PARTICIPANTS_MISSING');

    const [homeSnap, awaySnap] = await Promise.all([
      t.get(db.collection('players_v14').doc(String(homeId))),
      t.get(db.collection('players_v14').doc(String(awayId))),
    ]);
    if (!homeSnap.exists || !awaySnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const homeData: any = homeSnap.data() || {};
    const awayData: any = awaySnap.data() || {};
    const homeName = normalizeName(homeData.clubName || homeData.displayName || match.homeName || match.hostName, 'Home');
    const awayName = normalizeName(awayData.clubName || awayData.displayName || match.awayName || match.challengerName, 'Away');


    const simulation = runMatchEngine({
      mode: matchType,
      matchId,
      teamA: buildMatchTeamSnapshot(homeData, homeName, String(homeId), matchType),
      teamB: buildMatchTeamSnapshot(awayData, awayName, String(awayId), matchType),
      bestOf: Number(match.bestOf) === 1 ? 1 : Number(match.bestOf) === 3 ? 3 : 2,
    });

    const [scoreA, scoreB] = String(simulation.seriesScore || '0-0').split('-').map(Number);
    const winnerId = getMatchWinnerId(simulation.winnerSide, String(homeId), String(awayId));

    const report = {
      id: matchId,
      type: matchType,
      matchType,
      status: 'finished',
      isFinished: true,
      isProcessing: false,
      processingStartedAt: null,
      bestOf: simulation.bestOf,
      matchFormat: `BO${simulation.bestOf}`,
      homeId: String(homeId),
      awayId: String(awayId),
      homeName,
      awayName,
      homeLogo: homeData.clubLogo || match.homeLogo || null,
      awayLogo: awayData.clubLogo || match.awayLogo || null,
      scoreA,
      scoreB,
      homeScore: scoreA,
      awayScore: scoreB,
      seriesScore: simulation.seriesScore,
      score: simulation.seriesScore,
      winner: simulation.winner,
      winnerId,
      playedAt: now.toDate().toISOString(),
      resolvedAt: now.toDate().toISOString(),
      startTime: match.startTime || match.scheduledStartAt || now,
      scheduledStartAt: match.scheduledStartAt || match.startTime || now,
      startedAt: match.startedAt || now,
      homeStrength: simulation.homeStrength,
      awayStrength: simulation.awayStrength,
      homeOverall: simulation.homeOverall,
      awayOverall: simulation.awayOverall,
      simulation,
      games: simulation.games,
      reportStatus: 'new',
      seen: false,
      engineVersion: simulation.engineVersion,
      source: match.source || matchType,
      sourceLobbyId: match.sourceLobbyId || null,
      createdAt: match.createdAt || now,
      updatedAt: now,
    };

    // This document is the canonical Match Overview / Match Center report.
    // Never create a second report collection per match type. The optional rollover
    // lease is renewed in the same transaction, fencing an expired rollover owner.
    renewRolloverLock();
    t.set(ref, report, { merge: true });

    return { success: true, finished: true, matchId };
  });
}

/**
 * Canonical entry point for scheduled documents in their mode-specific collection.
 * Safe to call repeatedly; finished matches are only repaired, never simulated twice.
 */
export async function resolveDueUniversalMatch(matchId: string) {
  return resolveUniversalMatchDocument(matchId, { requireDue: true });
}
