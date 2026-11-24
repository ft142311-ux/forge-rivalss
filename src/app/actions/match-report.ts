'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { MATCH_COLLECTIONS, MATCH_REPORT_COLLECTIONS } from '@/app/lib/match-storage';

/**
 * Legacy league fixtures may identify participants by their league rank rather
 * than UID. Rank alone is not an identity: it repeats across every group.
 * Require the full canonical league coordinates to match the authenticated
 * profile before allowing this compatibility path.
 */
async function isRankBasedLeagueParticipant(db: any, uid: string, match: any, collectionName: string) {
  if (collectionName !== MATCH_COLLECTIONS.league) return false;

  const leagueId = String(match.leagueId || '').trim();
  const groupId = String(match.groupId || '').trim();
  const level = Number(match.level);
  const homeRank = Number(match.homeRank);
  const awayRank = Number(match.awayRank);
  if (!leagueId || !groupId || !Number.isInteger(level) ||
      !Number.isInteger(homeRank) || !Number.isInteger(awayRank)) return false;

  const profileSnap = await db.collection('players_v14').doc(uid).get();
  if (!profileSnap.exists) return false;
  const profile = profileSnap.data() || {};
  return String(profile.selectedLeagueId || '') === leagueId &&
    String(profile.groupId || '') === groupId &&
    Number(profile.leagueLevel) === level &&
    [homeRank, awayRank].includes(Number(profile.rank));
}

function serializeMatchReport(value: any): any {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeMatchReport);
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) output[key] = serializeMatchReport(child);
    return output;
  }
  return value;
}

/** Securely loads a match report from its mode-specific collection. */
export async function getMatchReportAction(idToken: string, matchId: string) {
  const { uid } = await requireServerActor(idToken);
  const id = String(matchId || '').trim();
  if (!id) return { success: false, error: 'INVALID_MATCH_ID' };
  const db = getAdminDb();

  for (const collectionName of MATCH_REPORT_COLLECTIONS) {
    const snap = await db.collection(collectionName).doc(id).get();
    if (!snap.exists) continue;
    const match: any = snap.data() || {};
    const participant = [match.homeId, match.awayId, match.homeUid, match.awayUid, match.hostId, match.challengerId]
      .some((participantId) => String(participantId || '') === uid);
    const rankParticipant = !participant
      ? await isRankBasedLeagueParticipant(db, uid, match, collectionName)
      : false;
    if (!participant && !rankParticipant) return { success: false, error: 'MATCH_ACCESS_DENIED' };
    return { success: true, match: serializeMatchReport({ ...match, id: snap.id }), collection: collectionName };
  }
  return { success: false, error: 'MATCH_NOT_FOUND' };
}

/**
 * Server-authoritative match report acknowledgement.
 * Client writes to all match-mode collections are forbidden by firestore.rules,
 * so viewed state must be persisted through Admin SDK.
 */
export async function markMatchViewedAction(idToken: string, matchId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const id = String(matchId || '').trim();
    if (!id) return { success: false, error: 'INVALID_MATCH_ID' };

    const db = getAdminDb();
    let ref: any = null;
    let snap: any = null;
    let collectionName = '';
    for (const candidate of MATCH_REPORT_COLLECTIONS) {
      const candidateRef = db.collection(candidate).doc(id);
      const candidateSnap = await candidateRef.get();
      if (candidateSnap.exists) {
        ref = candidateRef;
        snap = candidateSnap;
        collectionName = candidate;
        break;
      }
    }

    if (!snap?.exists) {
      // A report may still exist only in the client's legacy local history.
      return { success: true, persisted: false, localOnly: true };
    }

    const m = snap.data() || {};
    const isParticipant = [m.homeId, m.awayId, m.homeUid, m.awayUid, m.hostId, m.challengerId]
      .some((participantId) => String(participantId || '') === uid);

    // Legacy rank-based access is limited to an exact league/group/level match.
    const rankParticipant = !isParticipant
      ? await isRankBasedLeagueParticipant(db, uid, m, collectionName)
      : false;

    if (!isParticipant && !rankParticipant) {
      return { success: false, error: 'MATCH_ACCESS_DENIED' };
    }

    await ref.set({
      seen: true,
      reportStatus: 'viewed',
      viewedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true, persisted: true, collection: collectionName };
  } catch (error: any) {
    console.warn('[MATCH REPORT] mark viewed failed:', error);
    return { success: false, error: error?.message || 'MATCH_VIEW_MARK_FAILED' };
  }
}


/** Authenticated, profile-scoped queue for completed league match reports. */
export async function getMyLeagueMatchReportsAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const [profileSnap, configSnap] = await Promise.all([
    db.collection('players_v14').doc(uid).get(),
    db.collection('system_v1').doc('season_config').get(),
  ]);
  if (!profileSnap.exists) return { success: false, error: 'PLAYER_NOT_FOUND', matches: [] };
  const profile = profileSnap.data() || {};
  const leagueId = String(profile.selectedLeagueId || 'ALPHA');
  const level = Number(profile.leagueLevel);
  const groupId = String(profile.groupId || '');
  const rank = Number(profile.rank);
  const season = Math.max(1, Number(configSnap.data()?.activeSeasonNumber || 1));
  if (!Number.isInteger(level) || level < 1 || level > 4 || !groupId || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    return { success: false, error: 'INVALID_MANAGER_LEAGUE_PROFILE', matches: [] };
  }
  const snapshot = await db.collection(MATCH_COLLECTIONS.league).where('season', '==', season).get();
  const matches = snapshot.docs.flatMap((doc: any) => {
    const raw = doc.data() || {};
    const inGroup = String(raw.leagueId || '') === leagueId && Number(raw.level) === level && String(raw.groupId || '') === groupId;
    const participant = String(raw.homeId || raw.homeUid || '') === uid ||
      String(raw.awayId || raw.awayUid || '') === uid ||
      (inGroup && [Number(raw.homeRank), Number(raw.awayRank)].includes(rank));
    const finished = raw.isFinished === true || ['finished', 'completed', 'resolved'].includes(String(raw.status || '').toLowerCase());
    if (!inGroup || !participant || !finished) return [];
    return [serializeMatchReport({ ...raw, id: doc.id, type: 'league' })];
  }).sort((left: any, right: any) => new Date(right.playedAt || right.resolvedAt || right.startTime || 0).getTime() - new Date(left.playedAt || left.resolvedAt || left.startTime || 0).getTime());
  return { success: true, season, leagueId, level, groupId, rank, count: matches.length, matches };
}
