'use server';

import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { buildMatchTeamSnapshot } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';
import { normalizeName } from '@/app/lib/normalize-name';
import { assertMatchDocumentId } from '@/app/lib/match-id';
import { assertCronSecret } from '@/lib/server-cron-auth';
import { timestampToMillis } from '@/app/lib/timestamp-utils';

const LOBBY_TTL_MS = 5 * 60 * 1000;
const MATCH_DELAY_MS = 5 * 60 * 1000;

/** Server-side availability guard: never rely on client-only busy checks. */
async function assertFriendlyAvailabilityInTransaction(t: any, db: Firestore, uid: string) {
  const [basketSnap, hostedSnap, challengedSnap] = await Promise.all([
    t.get(db.collection('cw_basket_v2').doc(uid)),
    t.get(db.collection('friendly_matches_v1').where('hostId', '==', uid).limit(25)),
    t.get(db.collection('friendly_matches_v1').where('challengerId', '==', uid).limit(25)),
  ]);
  if (basketSnap.exists) {
    const basket = basketSnap.data() || {};
    const queueExpiryMs = basket.expiresAt?.toMillis?.() || ((basket.createdAt?.toMillis?.() || 0) + LOBBY_TTL_MS);
    if (basket.status === 'searching' && queueExpiryMs > Date.now()) {
      throw new Error('FRIENDLY_USER_BUSY');
    }
  }
  const active = [...hostedSnap.docs, ...challengedSnap.docs].some((snap: any) => {
    const status = snap.data()?.status;
    return status === 'scheduled' || status === 'starting';
  });
  if (active) throw new Error('FRIENDLY_USER_HAS_ACTIVE_MATCH');
}

function validateMatchId(matchId: string) {
  // Preserve friendly-match's historical allowance for backslashes.
  assertMatchDocumentId(matchId);
}


async function getProfile(db: Firestore, uid: string) {
  const snap = await db.collection('players_v14').doc(uid).get();
  if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
  return snap.data() || {};
}

export async function createFriendlyLobbyAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const profile = await getProfile(db, uid);
  const lobbyRef = db.collection('friendly_lobbies_v3').doc(uid);
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + LOBBY_TTL_MS);

  await db.runTransaction(async (t) => {
    const current = await t.get(lobbyRef);
    await assertFriendlyAvailabilityInTransaction(t, db, uid);
    if (current.exists) {
      const data = current.data() || {};
      const currentExpiry = data.expiresAt?.toMillis?.() || 0;
      if (data.status === 'searching' && currentExpiry > now) {
        throw new Error('FRIENDLY_LOBBY_ALREADY_ACTIVE');
      }
      // An accepted lobby is historical state, not a permanent lock. Allow a
      // new request once its linked match is finished or the match record is gone.
      if (data.status === 'accepted' && typeof data.matchId === 'string' && data.matchId) {
        const oldMatchSnap = await t.get(db.collection('friendly_matches_v1').doc(data.matchId));
        const oldStatus = oldMatchSnap.exists ? oldMatchSnap.data()?.status : null;
        if (oldStatus === 'scheduled' || oldStatus === 'starting') {
          throw new Error('FRIENDLY_USER_HAS_ACTIVE_MATCH');
        }
      }
    }

    t.set(lobbyRef, {
      hostId: uid,
      hostName: normalizeName(profile.clubName || profile.displayName),
      status: 'searching',
      challengerId: null,
      challengerName: null,
      rejectedChallengerIds: [],
      createdAt: Timestamp.fromMillis(now),
      expiresAt,
      updatedAt: Timestamp.fromMillis(now),
      matchId: null,
    });
  });

  return { success: true, expiresAtMs: expiresAt.toMillis() };
}

export async function cancelFriendlyLobbyAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const lobbyRef = db.collection('friendly_lobbies_v3').doc(uid);

  await db.runTransaction(async (t) => {
    const snap = await t.get(lobbyRef);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (data.hostId !== uid) throw new Error('FORBIDDEN');
    if (data.status !== 'searching') throw new Error('FRIENDLY_LOBBY_NOT_SEARCHING');
    t.delete(lobbyRef);
  });

  return { success: true };
}

export async function expireFriendlyLobbyAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const lobbyRef = db.collection('friendly_lobbies_v3').doc(uid);

  await db.runTransaction(async (t) => {
    const snap = await t.get(lobbyRef);
    if (!snap.exists) return;
    const data = snap.data() || {};
    const expiresAtMs = data.expiresAt?.toMillis?.() || 0;
    if (data.hostId !== uid) throw new Error('FORBIDDEN');
    if (data.status === 'searching' && expiresAtMs > Date.now()) return;
    if (data.status === 'searching') t.delete(lobbyRef);
  });

  return { success: true };
}

export async function challengeFriendlyLobbyAction(idToken: string, lobbyId: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const profile = await getProfile(db, uid);
  const lobbyRef = db.collection('friendly_lobbies_v3').doc(lobbyId);
  const now = Date.now();

  const transactionResult = await db.runTransaction(async (t) => {
    const snap = await t.get(lobbyRef);
    if (!snap.exists) throw new Error('FRIENDLY_LOBBY_NOT_FOUND');
    const data = snap.data() || {};
    // New lobbies always have expiresAt. For older emulator documents created
    // before this field existed, derive the same 5-minute TTL from createdAt.
    const createdAtMs = data.createdAt?.toMillis?.() || 0;
    const storedExpiresAtMs = data.expiresAt?.toMillis?.() || 0;
    const expiresAtMs = storedExpiresAtMs || (createdAtMs ? createdAtMs + LOBBY_TTL_MS : 0);

    if (data.hostId === uid) throw new Error('OWN_FRIENDLY_LOBBY');
    if (data.status !== 'searching') throw new Error('FRIENDLY_LOBBY_BUSY');
    if (!expiresAtMs || expiresAtMs <= now) {
      // Commit removal before reporting expiry; throwing inside the transaction
      // would roll back the delete.
      t.delete(lobbyRef);
      return { expired: true as const };
    }
    await assertFriendlyAvailabilityInTransaction(t, db, uid);
    if (Array.isArray(data.rejectedChallengerIds) && data.rejectedChallengerIds.includes(uid)) {
      throw new Error('FRIENDLY_CHALLENGE_REJECTED');
    }

    t.update(lobbyRef, {
      status: 'challenged',
      challengerId: uid,
      challengerName: normalizeName(profile.clubName || profile.displayName),
      challengedAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
    });
  });

  if (transactionResult?.expired) throw new Error('FRIENDLY_LOBBY_EXPIRED');
  return { success: true };
}

export async function respondFriendlyChallengeAction(
  idToken: string,
  decision: 'accept' | 'reject'
) {
  const { uid } = await requireServerActor(idToken);
  if (decision !== 'accept' && decision !== 'reject') throw new Error('INVALID_FRIENDLY_DECISION');
  const db = getAdminDb();
  const lobbyRef = db.collection('friendly_lobbies_v3').doc(uid);
  const now = Date.now();

  const result = await db.runTransaction(async (t) => {
    const lobbySnap = await t.get(lobbyRef);
    if (!lobbySnap.exists) throw new Error('FRIENDLY_LOBBY_NOT_FOUND');
    const lobby = lobbySnap.data() || {};

    if (lobby.hostId !== uid) throw new Error('FORBIDDEN');
    if (lobby.status !== 'challenged' || !lobby.challengerId) {
      throw new Error('NO_PENDING_FRIENDLY_CHALLENGE');
    }

    const expiresAtMs = lobby.expiresAt?.toMillis?.() || 0;
    if (!expiresAtMs || expiresAtMs <= now) {
      t.delete(lobbyRef);
      return { success: false as const, expired: true as const };
    }

    const challengerId = String(lobby.challengerId);
    const challengerName = normalizeName(lobby.challengerName);

    if (decision === 'reject') {
      t.update(lobbyRef, {
        status: 'searching',
        challengerId: null,
        challengerName: null,
        challengedAt: null,
        rejectedChallengerIds: FieldValue.arrayUnion(challengerId),
        updatedAt: Timestamp.fromMillis(now),
      });
      return { success: true, decision: 'rejected' as const };
    }

    const hostSnap = await t.get(db.collection('players_v14').doc(uid));
    const challengerSnap = await t.get(db.collection('players_v14').doc(challengerId));
    await assertFriendlyAvailabilityInTransaction(t, db, uid);
    await assertFriendlyAvailabilityInTransaction(t, db, challengerId);
    if (!hostSnap.exists || !challengerSnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const matchRef = db.collection('friendly_matches_v1').doc();
    const scheduledStartAt = Timestamp.fromMillis(now + MATCH_DELAY_MS);
    const hostData = hostSnap.data() || {};
    const challengerData = challengerSnap.data() || {};

    t.set(matchRef, {
      matchType: 'friendly',
      status: 'scheduled',
      hostId: uid,
      hostName: normalizeName(hostData.clubName || hostData.displayName),
      hostLogo: hostData.clubLogo || null,
      challengerId,
      challengerName: normalizeName(challengerData.clubName || challengerData.displayName, challengerName),
      challengerLogo: challengerData.clubLogo || null,
      createdAt: Timestamp.fromMillis(now),
      scheduledStartAt,
      startedAt: null,
      sourceLobbyId: lobbyRef.id,
    });

    t.update(lobbyRef, {
      status: 'accepted',
      matchId: matchRef.id,
      acceptedAt: Timestamp.fromMillis(now),
      scheduledStartAt,
      updatedAt: Timestamp.fromMillis(now),
      challengerId,
      challengerName,
    });

    return { success: true, decision: 'accepted' as const, matchId: matchRef.id, scheduledStartAtMs: scheduledStartAt.toMillis() };
  });

  if ('expired' in result && result.expired) throw new Error('FRIENDLY_LOBBY_EXPIRED');
  return result;
}

async function resolveFriendlyMatchDocument(matchId: string, collectionName: 'friendly_matches_v1' | 'association_matches_v1' = MATCH_COLLECTIONS.friendly) {
  const db = getAdminDb();
  const matchRef = db.collection(collectionName).doc(matchId);
  const now = Timestamp.now();

  return db.runTransaction(async (t) => {
    const matchSnap = await t.get(matchRef);
    if (!matchSnap.exists) throw new Error('FRIENDLY_MATCH_NOT_FOUND');
    const match = matchSnap.data() || {};

    const matchType = String(match.matchType || 'friendly').toLowerCase();

    if (match.status === 'finished') {
      if (matchType === 'basket') {
        const [hostQueue, challengerQueue] = await Promise.all([
          t.get(db.collection('cw_basket_v2').doc(String(match.hostId))),
          t.get(db.collection('cw_basket_v2').doc(String(match.challengerId))),
        ]);
        if (hostQueue.exists && hostQueue.data()?.matchId === matchId) t.delete(hostQueue.ref);
        if (challengerQueue.exists && challengerQueue.data()?.matchId === matchId) t.delete(challengerQueue.ref);
      }
      return { success: true, finished: true, alreadyResolved: true, matchId };
    }

    if (match.status !== 'scheduled') {
      return { success: true, finished: false, status: match.status, matchId };
    }

    const scheduledAtMs = timestampToMillis(match.scheduledStartAt);
    if (!scheduledAtMs || scheduledAtMs > now.toMillis()) {
      return { success: true, finished: false, status: 'scheduled', scheduledStartAtMs: scheduledAtMs, matchId };
    }

    const [homeSnap, awaySnap] = await Promise.all([
      t.get(db.collection('players_v14').doc(String(match.hostId))),
      t.get(db.collection('players_v14').doc(String(match.challengerId))),
    ]);
    if (!homeSnap.exists || !awaySnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const homeData = homeSnap.data() || {};
    const awayData = awaySnap.data() || {};
    const homeName = normalizeName(homeData.clubName || homeData.displayName, normalizeName(match.hostName));
    const awayName = normalizeName(awayData.clubName || awayData.displayName, normalizeName(match.challengerName));

    const simulation = runMatchEngine({
      mode: matchType === 'basket' ? 'cw-basket' : 'friendly',
      matchId,
      teamA: buildMatchTeamSnapshot(homeData, homeName, String(match.hostId), 'friendly'),
      teamB: buildMatchTeamSnapshot(awayData, awayName, String(match.challengerId), 'friendly'),
      bestOf: 2,
    });

    const [scoreA, scoreB] = simulation.seriesScore.split('-').map(Number);
    const report = {
      id: matchId,
      type: matchType,
      matchType,
      status: 'finished',
      isFinished: true,
      bestOf: simulation.bestOf,
      matchFormat: `BO${simulation.bestOf}`,
      homeId: String(match.hostId),
      awayId: String(match.challengerId),
      homeName,
      awayName,
      homeLogo: homeData.clubLogo || null,
      awayLogo: awayData.clubLogo || null,
      scoreA,
      scoreB,
      homeScore: scoreA,
      awayScore: scoreB,
      seriesScore: simulation.seriesScore,
      score: simulation.seriesScore,
      winner: simulation.winner,
      winnerId: simulation.winnerSide === 'home' ? String(match.hostId) : simulation.winnerSide === 'away' ? String(match.challengerId) : null,
      playedAt: now.toDate().toISOString(),
      resolvedAt: now.toDate().toISOString(),
      startTime: match.scheduledStartAt,
      scheduledStartAt: match.scheduledStartAt,
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
      source: match.source || (matchType === 'basket' ? 'cw-basket' : 'friendly'),
      sourceLobbyId: match.sourceLobbyId || null,
      createdAt: match.createdAt || now,
      updatedAt: now,
    };

    // Read both CW queue records before any transaction writes. The queue is
    // the cross-mode availability lock; release it only after the canonical
    // report and friendly match have been committed as finished.
    const cwQueueSnaps = matchType === 'basket'
      ? await Promise.all([
          t.get(db.collection('cw_basket_v2').doc(String(match.hostId))),
          t.get(db.collection('cw_basket_v2').doc(String(match.challengerId))),
        ])
      : [];

    // The mode-specific match document is also its report. Do not mirror
    // friendly/CW records into the league collection.
    t.set(matchRef, {
      ...report,
      hostId: String(match.hostId),
      challengerId: String(match.challengerId),
      startedAt: match.startedAt || now,
      reportId: matchId,
      updatedAt: now,
    }, { merge: true });
    for (const queueSnap of cwQueueSnaps) {
      if (queueSnap.exists && queueSnap.data()?.matchId === matchId) t.delete(queueSnap.ref);
    }

    // The report is persisted above. Do not return the Firestore-backed report
    // to Client Components: its Admin Timestamp values are not serializable by Next.js.
    // Callers only need the completion status and match ID.
    return { success: true, finished: true, matchId };
  });
}

/**
 * Compatibility entry point used by FriendlyMatchListener.
 *
 * Keep the public action name stable while the actual match lifecycle is
 * handled by the same server-side resolver used for friendly matches.
 * The operation is idempotent: a finished match is returned as already
 * resolved and is never simulated twice.
 */
export async function ensureFriendlyMatchReportAction(idToken: string, matchId: string) {
  validateMatchId(matchId);
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const matchRef = db.collection('friendly_matches_v1').doc(matchId);
  const snap = await matchRef.get();

  if (!snap.exists) throw new Error('FRIENDLY_MATCH_NOT_FOUND');
  const match = snap.data() || {};
  if (match.hostId !== uid && match.challengerId !== uid) throw new Error('FORBIDDEN');

  // If the canonical report already exists, do not simulate again.
  const reportSnap = await matchRef.get();
  if (reportSnap.exists && reportSnap.data()?.isFinished === true) {
    return { success: true, finished: true, alreadyResolved: true, matchId };
  }

  return resolveFriendlyMatchDocument(matchId);
}

export async function startFriendlyMatchAction(idToken: string, matchId: string) {
  validateMatchId(matchId);
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const matchRef = db.collection('friendly_matches_v1').doc(matchId);
  const now = Date.now();

  const snap = await matchRef.get();
  if (!snap.exists) throw new Error('FRIENDLY_MATCH_NOT_FOUND');
  const match = snap.data() || {};
  if (match.hostId !== uid && match.challengerId !== uid) throw new Error('FORBIDDEN');
  if (match.status === 'finished') return { success: true, started: false, finished: true, matchId };

  const scheduledAtMs = timestampToMillis(match.scheduledStartAt);
  if (!scheduledAtMs || scheduledAtMs > now) {
    return { success: true, started: false, finished: false, status: 'scheduled', scheduledStartAtMs: scheduledAtMs, matchId };
  }

  return resolveFriendlyMatchDocument(matchId);
}

export async function resolveFriendlyMatchAction(idToken: string, matchId: string) {
  validateMatchId(matchId);
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const matchRef = db.collection('friendly_matches_v1').doc(matchId);
  const snap = await matchRef.get();
  if (!snap.exists) throw new Error('FRIENDLY_MATCH_NOT_FOUND');
  const match = snap.data() || {};
  if (match.hostId !== uid && match.challengerId !== uid) throw new Error('FORBIDDEN');
  return resolveFriendlyMatchDocument(matchId);
}

/** Called by the cron endpoint so a match resolves even if neither manager is online. */
/** Compatibility entry point used by FriendlyMatchListener.
 * Resolves only due friendly matches belonging to the authenticated user.
 * The actual resolution still goes through the same canonical friendly resolver.
 */
export async function resolveDueFriendlyMatchesForUserAction(idToken: string, matchId?: string) {
  let uid: string;
  try {
    ({ uid } = await requireServerActor(idToken));
  } catch (error: any) {
    // This background action is polled from the global listener. Return a
    // recoverable auth result instead of turning a stale/revoked session into
    // an opaque Server Action HTTP 500. No match lookup or write occurs here.
    if (error?.message === 'AUTH_TOKEN_REVOKED' || error?.message === 'AUTH_TOKEN_INVALID') {
      return { success: false, resolved: 0, error: 'AUTH_SESSION_EXPIRED' };
    }
    throw error;
  }
  const db = getAdminDb();

  if (matchId) {
    validateMatchId(matchId);
    let collectionName: 'friendly_matches_v1' | 'association_matches_v1' = MATCH_COLLECTIONS.friendly;
    let ref = db.collection(collectionName).doc(matchId);
    let snap = await ref.get();
    if (!snap.exists) {
      collectionName = MATCH_COLLECTIONS.association;
      ref = db.collection(collectionName).doc(matchId);
      snap = await ref.get();
    }
    if (!snap.exists) throw new Error('FRIENDLY_MATCH_NOT_FOUND');
    const match = snap.data() || {};
    if (match.hostId !== uid && match.challengerId !== uid) throw new Error('FORBIDDEN');
    const scheduledAtMs = timestampToMillis(match.scheduledStartAt);
    if (match.status === 'finished' || !scheduledAtMs || scheduledAtMs > Date.now()) {
      return { success: true, resolved: 0, matchId };
    }
    const result = await resolveFriendlyMatchDocument(matchId, collectionName);
    return { success: true, resolved: result?.finished ? 1 : 0, matchId, result };
  }

  const loadUserMatches = async (field: 'hostId' | 'challengerId', collectionName: 'friendly_matches_v1' | 'association_matches_v1') => {
    const collection = db.collection(collectionName);
    const documents: any[] = [];
    let cursor: any = null;
    while (true) {
      let query = collection.where(field, '==', uid).orderBy(FieldPath.documentId()).limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      documents.push(...page.docs);
      cursor = page.docs[page.docs.length - 1];
      if (page.size < 100) break;
    }
    return documents;
  };
  const [hosted, challenged, associationHosted, associationChallenged] = await Promise.all([
    loadUserMatches('hostId', MATCH_COLLECTIONS.friendly),
    loadUserMatches('challengerId', MATCH_COLLECTIONS.friendly),
    loadUserMatches('hostId', MATCH_COLLECTIONS.association),
    loadUserMatches('challengerId', MATCH_COLLECTIONS.association),
  ]);

  const seen = new Set<string>();
  let resolved = 0;
  const pending = [
    ...hosted.map((doc: any) => ({ doc, collectionName: MATCH_COLLECTIONS.friendly })),
    ...challenged.map((doc: any) => ({ doc, collectionName: MATCH_COLLECTIONS.friendly })),
    ...associationHosted.map((doc: any) => ({ doc, collectionName: MATCH_COLLECTIONS.association })),
    ...associationChallenged.map((doc: any) => ({ doc, collectionName: MATCH_COLLECTIONS.association })),
  ];
  for (const item of pending) {
    const snap = item.doc;
    const dedupeKey = `${item.collectionName}:${snap.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const match = snap.data() || {};
    const scheduledAtMs = timestampToMillis(match.scheduledStartAt);
    if (match.status !== 'scheduled' || !scheduledAtMs || scheduledAtMs > Date.now()) continue;
    try {
      const result = await resolveFriendlyMatchDocument(snap.id, item.collectionName);
      if (result?.finished) resolved++;
    } catch (error) {
      console.error('[FRIENDLY USER RESOLVE]', snap.id, error);
    }
  }

  return { success: true, resolved };
}

export async function resolveDueFriendlyMatches(cronSecret: string) {
  assertCronSecret(cronSecret);
  const db = getAdminDb();
  const matches = db.collection('friendly_matches_v1');
  const nowMs = Date.now();
  const pageSize = 100;
  let cursor: any = null;
  let scanned = 0;
  let resolved = 0;
  let pages = 0;
  const errors: Array<{ matchId: string; error: string }> = [];

  // Paginate the complete scheduled set by document ID. We intentionally
  // normalize scheduledStartAt in code because older documents may use mixed
  // Timestamp/string/number representations that cannot share one range query.
  while (true) {
    let query = matches.where('status', '==', 'scheduled')
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    pages++;
    scanned += page.size;

    for (const docSnap of page.docs) {
      const data = docSnap.data() || {};
      const scheduledAtMs = timestampToMillis(data.scheduledStartAt);
      if (!Number.isFinite(scheduledAtMs) || scheduledAtMs > nowMs) continue;
      try {
        const result = await resolveFriendlyMatchDocument(docSnap.id);
        if (result?.finished) resolved++;
      } catch (error: any) {
        const message = String(error?.message || 'FRIENDLY_MATCH_RESOLUTION_FAILED');
        errors.push({ matchId: docSnap.id, error: message.slice(0, 240) });
        console.error('[FRIENDLY MATCH RESOLVE]', docSnap.id, error);
      }
    }

    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }

  return { success: errors.length === 0, scanned, pages, resolved, failed: errors.length, errors: errors.slice(0, 50) };
}


/** Resolves CW/association matches from their isolated collection via the same Match Engine. */
export async function resolveDueAssociationMatches(cronSecret: string) {
  assertCronSecret(cronSecret);
  const db = getAdminDb();
  const matches = db.collection(MATCH_COLLECTIONS.association);
  const nowMs = Date.now();
  const pageSize = 100;
  let cursor: any = null;
  let scanned = 0;
  let resolved = 0;
  let pages = 0;
  const errors: Array<{ matchId: string; error: string }> = [];

  while (true) {
    let query = matches.where('status', '==', 'scheduled')
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    pages++;
    scanned += page.size;
    for (const docSnap of page.docs) {
      const data = docSnap.data() || {};
      const scheduledAtMs = timestampToMillis(data.scheduledStartAt);
      if (!Number.isFinite(scheduledAtMs) || scheduledAtMs > nowMs) continue;
      try {
        const result = await resolveFriendlyMatchDocument(docSnap.id, MATCH_COLLECTIONS.association);
        if (result?.finished) resolved++;
      } catch (error: any) {
        errors.push({ matchId: docSnap.id, error: String(error?.message || 'ASSOCIATION_MATCH_RESOLUTION_FAILED').slice(0, 240) });
      }
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }
  return { success: errors.length === 0, scanned, pages, resolved, failed: errors.length, errors: errors.slice(0, 50) };
}
