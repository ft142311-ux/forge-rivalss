'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { MATCH_COLLECTIONS, MATCH_REPORT_COLLECTIONS } from '@/app/lib/match-storage';
import { isMatchReportFinished, isMatchWithinClubLifetime } from '@/app/lib/match-report-utils';
import { countUnreadMatchReportRecords } from '@/app/lib/unread-match-report-count';

/** A match may carry both legacy club IDs and explicit manager UID fields. */
function isMatchReportParticipant(match: any, uid: string): boolean {
  const managerId = String(uid || '').trim();
  if (!managerId) return false;
  return [
    match?.homeId, match?.awayId, match?.homeUid, match?.awayUid,
    match?.hostId, match?.challengerId,
  ].some(value => String(value || '').trim() === managerId);
}

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

  const profileSnap = await db.collection('players_v14').doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : null;
  let found = false;

  for (const collectionName of MATCH_REPORT_COLLECTIONS) {
    const snap = await db.collection(collectionName).doc(id).get();
    if (!snap.exists) continue;
    found = true;
    const match: any = snap.data() || {};
    if (!profile || !isMatchWithinClubLifetime(match, profile.createdAt)) continue;

    const participant = isMatchReportParticipant(match, uid);
    const rankParticipant = !participant
      ? await isRankBasedLeagueParticipant(db, uid, match, collectionName, profile)
      : false;
    if (!participant && !rankParticipant) continue;

    return { success: true, match: serializeMatchReport({ ...match, id: snap.id }), collection: collectionName };
  }
  return { success: false, error: found ? 'MATCH_ACCESS_DENIED' : 'MATCH_NOT_FOUND' };
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
    const candidates = MATCH_REPORT_COLLECTIONS.map(collectionName => ({
      collectionName,
      ref: db.collection(collectionName).doc(id),
    }));
    const profileRef = db.collection('players_v14').doc(uid);
    const configRef = db.collection('system_v1').doc('season_config');

    return await db.runTransaction(async (tx: any) => {
      // Read every possible mode-specific copy before writing anything. A
      // shared route ID can exist in more than one collection after a legacy
      // mirror, so acknowledging only the first copy leaves the queue stuck.
      const [profileSnap, configSnap, ...matchSnaps] = await Promise.all([
        tx.get(profileRef),
        tx.get(configRef),
        ...candidates.map(candidate => tx.get(candidate.ref)),
      ]);

      // The report acknowledgement and reset claim now contend on the same
      // config document. A reset cannot archive a stale unread state while a
      // concurrent acknowledgement silently lands after its archive snapshot.
      const resetState = configSnap.exists ? configSnap.data() || {} : {};
      if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
        return { success: false, error: 'STAGING_SEASON_ONE_RESET_IN_PROGRESS' };
      }

      const found = matchSnaps.some((snap: any) => snap.exists);
      if (!found) return { success: true, persisted: false, localOnly: true };

      const profile = profileSnap.exists ? profileSnap.data() || {} : null;
      if (!profile) return { success: false, error: 'MATCH_ACCESS_DENIED' };

      const acknowledged = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const snap = matchSnaps[index];
        if (!snap?.exists) continue;
        const match = snap.data() || {};
        if (!isMatchWithinClubLifetime(match, profile.createdAt)) continue;

        const participant = isMatchReportParticipant(match, uid);
        const rankParticipant = !participant
          ? await isRankBasedLeagueParticipant(db, uid, match, candidates[index].collectionName, profile)
          : false;
        if (participant || rankParticipant) acknowledged.push(candidates[index]);
      }

      if (!acknowledged.length) return { success: false, error: 'MATCH_ACCESS_DENIED' };

      // update is non-creating: the transaction never recreates a report that
      // was deleted between the collection lookup and this acknowledgement.
      const viewedAt = FieldValue.serverTimestamp();
      for (const candidate of acknowledged) {
        tx.update(candidate.ref, {
          seen: true,
          reportStatus: 'viewed',
          viewedAt,
        });
      }
      return {
        success: true,
        persisted: true,
        collections: acknowledged.map(candidate => candidate.collectionName),
        updatedCopies: acknowledged.length,
      };
    });
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
    const participant = isMatchReportParticipant(raw, uid) ||
      (inGroup && [Number(raw.homeRank), Number(raw.awayRank)].includes(rank));
    const finished = isMatchReportFinished(raw);
    if (!inGroup || !participant || !finished || !isMatchWithinClubLifetime(raw, profile.createdAt) ||
        raw.seen === true || raw.reportStatus === 'viewed') return [];
    return [serializeMatchReport({ ...raw, id: doc.id, type: 'league' })];
  }).sort((left: any, right: any) => new Date(right.playedAt || right.resolvedAt || right.startTime || 0).getTime() - new Date(left.playedAt || left.resolvedAt || left.startTime || 0).getTime());
  return { success: true, season, leagueId, level, groupId, rank, count: matches.length, matches };
}


/** Authenticated unread-report badge count across every match mode. */
export async function getMyUnreadMatchReportsCountAction(idToken: string, rawLocalViewedIds: unknown = []) {
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

  const locallyViewedIds = Array.isArray(rawLocalViewedIds)
    ? rawLocalViewedIds
        .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 180)
        .slice(-2000)
    : [];
  const count = countUnreadMatchReportRecords(
    [...records.values()],
    uid,
    profile.createdAt,
    league,
    locallyViewedIds,
  );
  return { success: true, season, count };
}
