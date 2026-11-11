'use server';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { buildMatchTeamSnapshot, createDeterministicBotSquad } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';
import { hash32 } from '@/app/lib/hash-utils';
import { timestampToMillis } from '@/app/lib/timestamp-utils';
import { getMatchWinnerId } from '@/app/lib/match-winner';

function startTimeMs(match: any): number {
  const raw = match?.startTime || match?.scheduledStartAt || match?.scheduledAt;
  return timestampToMillis(raw);
}


/** Creates and persists an immediate BO2 trial match using the authoritative profile. */
export async function createTrialMatchAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const profile: any = profileSnap.data() || {};
    const ownedPlayers: any[] = Array.isArray(profile.ownedPlayers) ? profile.ownedPlayers : [];
    const lineup = profile.lineup || {};
    const starterSlots = ['carry', 'mid', 'offlane', 'support', 'full_support'];
    const starterIds = starterSlots.map((slot) => lineup[slot]).filter((id) => typeof id === 'string' && id.length > 0);
    if (starterIds.length !== 5 || new Set(starterIds).size !== 5) throw new Error('FIVE_STARTERS_REQUIRED');
    const starters = starterIds.map((id) => ownedPlayers.find((player) => String(player?.id) === id)).filter(Boolean);
    if (starters.length !== 5) throw new Error('STARTER_NOT_OWNED');

    const matchId = `trial_${uid}_${Date.now()}_${hash32(`${uid}:trial:${Date.now()}`)}`;
    const homeName = String(profile.clubName || profile.displayName || 'My Club');
    const botOverall = 23 + (hash32(`${matchId}:bot-ovr`) % 5);
    const botId = `trial_bot_${hash32(`${matchId}:bot-id`)}`;
    const botName = `Bot${String(hash32(`${botId}:name`) % 1_000_000).padStart(6, '0')}`;
    const botPlayers = createDeterministicBotSquad(`${uid}:${matchId}`, botOverall);

    const teamA = buildMatchTeamSnapshot({ ...profile, ownedPlayers: starters }, homeName, uid, 'trial');
    const teamB = buildMatchTeamSnapshot({ clubName: botName, ownedPlayers: botPlayers, strategy: 'Balanced Play' }, botName, botId, 'trial');
    if ((teamA.players?.length ?? 0) !== 5 || (teamB.players?.length ?? 0) !== 5) throw new Error('TRIAL_TEAM_INVALID');

    const simulation = runMatchEngine({ mode: 'trial', matchId, teamA, teamB, bestOf: 2 });
    const [scoreA, scoreB] = simulation.seriesScore.split('-').map(Number);
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) throw new Error('INVALID_TRIAL_MATCH_SCORE');
    const playedAt = new Date().toISOString();
    const report = {
      id: matchId,
      type: 'trial',
      matchType: 'trial',
      isTrial: true,
      status: 'finished',
      isFinished: true,
      bestOf: 2,
      matchFormat: 'BO2',
      homeId: uid,
      awayId: botId,
      homeName,
      awayName: botName,
      homeLogo: profile.clubLogo || null,
      awayLogo: null,
      homeScore: scoreA,
      awayScore: scoreB,
      scoreA,
      scoreB,
      seriesScore: `${scoreA}-${scoreB}`,
      score: `${scoreA}-${scoreB}`,
      winner: simulation.winner,
      winnerId: getMatchWinnerId(simulation.winnerSide, uid, botId),
      playedAt,
      resolvedAt: playedAt,
      homeStrength: simulation.homeStrength,
      awayStrength: simulation.awayStrength,
      homeOverall: simulation.homeOverall,
      awayOverall: simulation.awayOverall,
      opponentOverall: botOverall,
      viewers: 120 + (hash32(`${matchId}:viewers`) % 881),
      simulation,
      games: simulation.games,
      reportStatus: 'new',
      seen: false,
      engineVersion: simulation.engineVersion,
      source: 'trial-server',
    };

    const matchRef = db.collection(MATCH_COLLECTIONS.trial).doc(matchId);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(matchRef);
      if (existing.exists) throw new Error('TRIAL_MATCH_ID_COLLISION');
      tx.create(matchRef, { ...report, createdAt: FieldValue.serverTimestamp() });
    });

    return { success: true, matchId, report };
  } catch (error: any) {
    return { success: false, error: error?.message || 'TRIAL_MATCH_CREATE_FAILED' };
  }
}

/**
 * Resolves due trial matches for the authenticated home club only.
 * The client never simulates or writes a result; transaction claims and final
 * writes prevent concurrent browser tabs from resolving the same match twice.
 */
export async function resolveDueTrialMatchesForUserAction(idToken: string) {
  let uid: string;
  try {
    ({ uid } = await requireServerActor(idToken));
  } catch (error: any) {
    // This action is called by the global background poller. A revoked
    // session must stop the poll without surfacing as an opaque HTTP 500.
    if (error?.message === 'AUTH_TOKEN_REVOKED' || error?.message === 'AUTH_TOKEN_INVALID') {
      return { success: false, resolved: 0, skipped: 0, error: 'AUTH_SESSION_EXPIRED' };
    }
    throw error;
  }
  const db = getAdminDb();
  const snapshot = await db.collection(MATCH_COLLECTIONS.trial)
    .where('homeId', '==', uid)
    .where('isTrial', '==', true)
    .where('isFinished', '==', false)
    .limit(25)
    .get();

  let resolved = 0;
  let skipped = 0;

  for (const matchDoc of snapshot.docs) {
    const matchId = matchDoc.id;
    const match = matchDoc.data() as any;
    const dueAt = startTimeMs(match);
    if (!Number.isFinite(dueAt) || dueAt > Date.now() || !match.teamA || !match.teamB || match.isProcessing) {
      skipped++;
      continue;
    }

    const matchRef = db.collection(MATCH_COLLECTIONS.trial).doc(matchId);
    let claimed = false;
    try {
      claimed = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(matchRef);
        const data = fresh.data() as any;
        if (!fresh.exists || data?.homeId !== uid || data?.isTrial !== true || data?.isFinished === true || data?.isProcessing === true) return false;
        const freshDueAt = startTimeMs(data);
        if (!Number.isFinite(freshDueAt) || freshDueAt > Date.now() || !data.teamA || !data.teamB) return false;
        transaction.update(matchRef, {
          isProcessing: true,
          status: 'processing',
          processingStartedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!claimed) { skipped++; continue; }

      const simulation = runMatchEngine({ mode: 'trial', matchId, teamA: match.teamA, teamB: match.teamB, bestOf: 2 });
      const [scoreA, scoreB] = simulation.seriesScore.split('-').map(Number);
      if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) throw new Error('INVALID_TRIAL_MATCH_SCORE');
      const finishedAt = new Date().toISOString();

      const finalized = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(matchRef);
        const data = fresh.data() as any;
        if (!fresh.exists || data?.homeId !== uid || data?.isTrial !== true) throw new Error('TRIAL_MATCH_OWNERSHIP_CHANGED');
        if (data?.isFinished === true) return false;
        if (data?.isProcessing !== true) throw new Error('TRIAL_MATCH_LOCK_LOST');
        transaction.update(matchRef, {
          scoreA, scoreB, homeScore: scoreA, awayScore: scoreB,
          seriesScore: `${scoreA}-${scoreB}`, score: `${scoreA}-${scoreB}`,
          winner: simulation.winner,
          winnerId: getMatchWinnerId(simulation.winnerSide, data.homeId, data.awayId),
          status: 'finished', isFinished: true, isProcessing: false,
          simulation, games: simulation.games, homeStrength: simulation.homeStrength,
          awayStrength: simulation.awayStrength, homeOverall: simulation.homeOverall,
          awayOverall: simulation.awayOverall, playedAt: finishedAt,
          resolvedAt: finishedAt, finishedAt: FieldValue.serverTimestamp(),
          reportStatus: 'new', seen: false, engineVersion: simulation.engineVersion,
          source: 'trial-scheduler', processingFinishedAt: Timestamp.now(),
        });
        return true;
      });
      if (finalized) resolved++;
    } catch (error) {
      console.error('[TRIAL MATCH SERVER] Resolution failed:', matchId, error);
      if (claimed) {
        await db.runTransaction(async transaction => {
          const fresh = await transaction.get(matchRef);
          const data = fresh.data() as any;
          if (fresh.exists && data?.homeId === uid && data?.isTrial === true && data?.isFinished !== true && data?.isProcessing === true) {
            transaction.update(matchRef, { isProcessing: false, status: 'scheduled', processingErrorAt: FieldValue.serverTimestamp() });
          }
        }).catch(resetError => console.error('[TRIAL MATCH SERVER] Could not release claim:', matchId, resetError));
      }
    }
  }

  return { success: true, resolved, skipped };
}
