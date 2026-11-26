'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { MATCH_COLLECTIONS, MATCH_REPORT_COLLECTIONS } from '@/app/lib/match-storage';
import { isMatchReportFinished, isMatchWithinClubLifetime } from '@/app/lib/match-report-utils';
import { countUnreadMatchReportRecords } from '@/app/lib/unread-match-report-count';

/**
 * Legacy league fixtures may identify participants by their league rank rather
 * than UID. Rank alone is not an identity: it repeats across every group.
 * Require the full canonical league coordinates to match the authenticated
 * profile before allowing this compatibility path.
 */
async function isRankBasedLeagueParticipant(db: any, uid: string, match: any, collectionName: string, profileOverride?: any) {
  if (collectionName !== MATCH_COLLECTIONS.league) return false;

  const leagueId = String(match.leagueId || '').trim();
  const groupId = String(match.groupId || '').trim();
  const level = Number(match.level);
  const homeRank = Number(match.homeRank);
  const awayRank = Number(match.awayRank);
  if (!leagueId || !groupId || !Number.isInteger(level) ||
      !Number.isInteger(homeRank) || !Number.isInteger(awayRank)) return false;

  const profile = profileOverride === undefined
    ? await db.collection('players_v14').doc(uid).get().then((snap: any) => snap.exists ? snap.data() || {} : null)
    : profileOverride;
  if (!profile) return false;
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
    const profileSnap = await db.collection('players_v14').doc(uid).get();
    const profile = profileSnap.exists ? profileSnap.data() || {} : null;
    if (!profile || !isMatchWithinClubLifetime(match, profile.createdAt)) {
      return { success: false, error: 'MATCH_ACCESS_DENIED' };
    }
    const rankParticipant = !participant
      ? await isRankBasedLeagueParticipant(db, uid, match, collectionName, profile)
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
      return { success: true, persisted: false, localOnly: true };
    }

    const m = snap.data() || {};
    const isParticipant = [m.homeId, m.awayId, m.homeUid, m.awayUid, m.hostId, m.challengerId]
      .some((participantId) => String(participantId || '') === uid);
    const profileSnap = await db.collection('players_v14').doc(uid).get();
    const profile = profileSnap.exists ? profileSnap.data() || {} : null;
    if (!profile || !isMatchWithinClubLifetime(m, profile.createdAt)) {
      return { success: false, error: 'MATCH_ACCESS_DENIED' };
    }
    const rankParticipant = !isParticipant
      ? await isRankBasedLeagueParticipant(db, uid, m, collectionName, profile)
      : false;

    if (!isParticipant && !rankParticipant) {
      return { success: false, error: 'MATCH_ACCESS_DENIED' };
    }

    try {
      // update() is intentionally non-creating: a report deleted after the
      // ownership read must not be recreated as a partial viewed-only document.
      await ref.update({
        seen: true,
        reportStatus: 'viewed',
        viewedAt: FieldValue.serverTimestamp(),
      });
    } catch (error: any) {
      const code = String(error?.code ?? '').toLowerCase();
      if (code === '5' || code === 'not-found' || code === 'not_found' || code === 'firestore/not-found') {
        return { success: true, persisted: false, localOnly: true };
      }
      throw error;
    }

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
  const snapshot = await db.collection(MATCH_COLLECTIONS.league)
    .where('season', '==', season)
    .where('leagueId', '==', leagueId)
    .where('level', '==', level)
    .where('groupId', '==', groupId)
    .get();
  const matches = snapshot.docs.flatMap((doc: any) => {
    const raw = doc.data() || {};
    const inGroup = String(raw.leagueId || '') === leagueId && Number(raw.level) === level && String(raw.groupId || '') === groupId;
    const participant = String(raw.homeId || raw.homeUid || '') === uid ||
      String(raw.awayId || raw.awayUid || '') === uid ||
      (inGroup && [Number(raw.homeRank), Number(raw.awayRank)].includes(rank));
    const finished = isMatchReportFinished(raw);
    if (!inGroup || !participant || !finished || !isMatchWithinClubLifetime(raw, profile.createdAt) ||
        raw.seen === true || raw.reportStatus === 'viewed') return [];
    return [serializeMatchReport({ ...raw, id: doc.id, type: 'league' })];
  }).sort((left: any, right: any) => new Date(right.playedAt || right.resolvedAt || right.startTime || 0).getTime() - new Date(left.playedAt || left.resolvedAt || left.startTime || 0).getTime());
  return { success: true, season, leagueId, level, groupId, rank, count: matches.length, matches };
}


/** Authenticated unread-report badge count across every match mode. */
export async function getMyUnreadMatchReportsCountAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const [profileSnap, configSnap] = await Promise.all([
    db.collection('players_v14').doc(uid).get(),
    db.collection('system_v1').doc('season_config').get(),
  ]);
  if (!profileSnap.exists) return { success: false, error: 'PLAYER_NOT_FOUND', count: 0 };
  const profile = profileSnap.data() || {};
  const league = {
    leagueId: String(profile.selectedLeagueId || 'ALPHA'),
    level: Number(profile.leagueLevel),
    groupId: String(profile.groupId || ''),
    rank: Number(profile.rank),
  };
  if (!Number.isInteger(league.level) || league.level < 1 || league.level > 4 ||
      !league.groupId || !Number.isInteger(league.rank) || league.rank < 1 || league.rank > 8) {
    return { success: false, error: 'INVALID_MANAGER_LEAGUE_PROFILE', count: 0 };
  }

  const season = Math.max(1, Number(configSnap.data()?.activeSeasonNumber || 1));
  const querySpecs: Array<{ collectionName: string; field: string }> = [
    { collectionName: MATCH_COLLECTIONS.league, field: 'homeId' },
    { collectionName: MATCH_COLLECTIONS.league, field: 'awayId' },
    { collectionName: MATCH_COLLECTIONS.league, field: 'homeUid' },
    { collectionName: MATCH_COLLECTIONS.league, field: 'awayUid' },
    { collectionName: MATCH_COLLECTIONS.cup, field: 'homeId' },
    { collectionName: MATCH_COLLECTIONS.cup, field: 'awayId' },
    { collectionName: MATCH_COLLECTIONS.friendly, field: 'hostId' },
    { collectionName: MATCH_COLLECTIONS.friendly, field: 'challengerId' },
    { collectionName: MATCH_COLLECTIONS.friendly, field: 'homeId' },
    { collectionName: MATCH_COLLECTIONS.friendly, field: 'awayId' },
    { collectionName: MATCH_COLLECTIONS.association, field: 'hostId' },
    { collectionName: MATCH_COLLECTIONS.association, field: 'challengerId' },
    { collectionName: MATCH_COLLECTIONS.tournament, field: 'homeId' },
    { collectionName: MATCH_COLLECTIONS.tournament, field: 'awayId' },
    { collectionName: MATCH_COLLECTIONS.trial, field: 'homeId' },
    { collectionName: MATCH_COLLECTIONS.trial, field: 'awayId' },
  ];
  const [activeLeagueMatches, ...participantSnapshots] = await Promise.all([
    db.collection(MATCH_COLLECTIONS.league)
      .where('season', '==', season)
      .where('leagueId', '==', league.leagueId)
      .where('level', '==', league.level)
      .where('groupId', '==', league.groupId)
      .get(),
    ...querySpecs.map(spec =>
      db.collection(spec.collectionName).where(spec.field, '==', uid).get()
    ),
  ]);

  const records = new Map<string, { id: string; collectionName: string; match: any }>();
  const addSnapshot = (collectionName: string, snapshot: any) => {
    for (const doc of snapshot.docs || []) {
      records.set(`${collectionName}/${doc.id}`, {
        id: doc.id,
        collectionName,
        match: doc.data() || {},
      });
    }
  };
  addSnapshot(MATCH_COLLECTIONS.league, activeLeagueMatches);
  participantSnapshots.forEach((snapshot, index) =>
    addSnapshot(querySpecs[index].collectionName, snapshot)
  );

  const count = countUnreadMatchReportRecords(
    [...records.values()],
    uid,
    profile.createdAt,
    league,
  );
  return { success: true, season, count };
}
