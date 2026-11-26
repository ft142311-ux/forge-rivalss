'use server';

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';

const CW_QUEUE_TTL_MS = 5 * 60 * 1000;
const CW_MATCH_DELAY_MS = 15 * 60 * 1000;
const CW_CANDIDATE_SCAN_LIMIT = 25;

type QueueEntry = {
  userId?: string;
  userName?: string;
  status?: string;
  expiresAt?: { toMillis?: () => number };
  createdAt?: { toMillis?: () => number };
  matchedWithId?: string | null;
  matchedWithName?: string | null;
  matchId?: string | null;
};

function getQueueExpiryMs(entry: QueueEntry): number {
  const explicit = entry.expiresAt?.toMillis?.() || 0;
  if (explicit > 0) return explicit;
  const created = entry.createdAt?.toMillis?.() || 0;
  return created > 0 ? created + CW_QUEUE_TTL_MS : 0;
}

async function assertNoActiveFriendlyState(t: any, db: Firestore, uid: string, nowMs: number) {
  const lobbyRef = db.collection('friendly_lobbies_v3').doc(uid);
  const [lobbySnap, hostedSnap, challengedSnap, associationHostedSnap, associationChallengedSnap] = await Promise.all([
    t.get(lobbyRef),
    t.get(db.collection(MATCH_COLLECTIONS.friendly).where('hostId', '==', uid).limit(25)),
    t.get(db.collection(MATCH_COLLECTIONS.friendly).where('challengerId', '==', uid).limit(25)),
    t.get(db.collection(MATCH_COLLECTIONS.association).where('hostId', '==', uid).limit(25)),
    t.get(db.collection(MATCH_COLLECTIONS.association).where('challengerId', '==', uid).limit(25)),
  ]);

  if (lobbySnap.exists) {
    const lobby = lobbySnap.data() || {};
    const status = String(lobby.status || '');
    const expiryMs = lobby.expiresAt?.toMillis?.() || ((lobby.createdAt?.toMillis?.() || 0) + 5 * 60 * 1000);
    if ((status === 'searching' || status === 'challenged') && expiryMs > nowMs) {
      throw new Error('CW_USER_HAS_ACTIVE_FRIENDLY_LOBBY');
    }
  }

  const activeMatch = [...hostedSnap.docs, ...challengedSnap.docs, ...associationHostedSnap.docs, ...associationChallengedSnap.docs].some((doc: any) => {
    const status = String(doc.data()?.status || '');
    return status === 'scheduled' || status === 'starting';
  });
  if (activeMatch) throw new Error('CW_USER_HAS_ACTIVE_FRIENDLY_MATCH');
}

async function readProfileInTransaction(t: any, db: Firestore, uid: string) {
  const snap = await t.get(db.collection('players_v14').doc(uid));
  if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
  return snap.data() || {};
}

/**
 * Joins the caller to the CW queue or atomically pairs them with one waiting
 * manager. Queue documents are server-owned; a matched pair is represented by
 * one canonical association_matches_v1 record and resolved by the shared
 * Match Engine through the association-match adapter.
 */
export async function joinCwBasketQueueAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const nowMs = Date.now();
  const now = Timestamp.fromMillis(nowMs);
  const ownQueueRef = db.collection('cw_basket_v2').doc(uid);

  return db.runTransaction(async (t: any) => {
    const [ownQueueSnap, ownProfile] = await Promise.all([
      t.get(ownQueueRef),
      readProfileInTransaction(t, db, uid),
    ]);
    const ownQueue = (ownQueueSnap.exists ? ownQueueSnap.data() : {}) as QueueEntry;
    const cleanupQueueRefs: any[] = [];

    if (ownQueue.status === 'matched' && ownQueue.matchId) {
      let oldMatchRef = db.collection(MATCH_COLLECTIONS.association).doc(String(ownQueue.matchId));
      let oldMatchSnap = await t.get(oldMatchRef);
      if (!oldMatchSnap.exists) {
        // Read legacy CW records created before the association collection split.
        oldMatchRef = db.collection(MATCH_COLLECTIONS.friendly).doc(String(ownQueue.matchId));
        oldMatchSnap = await t.get(oldMatchRef);
      }
      const oldStatus = oldMatchSnap.exists ? String(oldMatchSnap.data()?.status || '') : '';
      if (oldStatus === 'scheduled' || oldStatus === 'starting') {
        return {
          success: true as const,
          status: 'matched' as const,
          matchId: String(ownQueue.matchId),
          matchedWithId: String(ownQueue.matchedWithId || ''),
          matchedWithName: String(ownQueue.matchedWithName || 'Manager'),
          matchStartTime: oldMatchSnap.data()?.scheduledStartAt?.toDate?.().toISOString?.() || null,
        };
      }

      const previousOpponentId = String(ownQueue.matchedWithId || '');
      const previousOpponentRef = previousOpponentId
        ? db.collection('cw_basket_v2').doc(previousOpponentId)
        : null;
      const previousOpponentSnap = previousOpponentRef ? await t.get(previousOpponentRef) : null;
      if (previousOpponentSnap?.exists && previousOpponentSnap.data()?.matchId === ownQueue.matchId) {
        cleanupQueueRefs.push(previousOpponentRef);
      }
    }

    await assertNoActiveFriendlyState(t, db, uid, nowMs);

    const currentQueueSnap = ownQueue.status === 'matched' ? null : ownQueueSnap;
    if (
      currentQueueSnap?.exists &&
      ownQueue.status === 'searching' &&
      getQueueExpiryMs(ownQueue) > nowMs
    ) {
      return { success: true as const, status: 'searching' as const, expiresAtMs: getQueueExpiryMs(ownQueue) };
    }

    const candidatesQuery = db.collection('cw_basket_v2')
      .where('status', '==', 'searching')
      .limit(CW_CANDIDATE_SCAN_LIMIT);
    const candidatesSnap = await t.get(candidatesQuery);

    const staleQueueRefs: any[] = [];
    let selected: {
      ref: any;
      id: string;
      entry: QueueEntry;
      profile: Record<string, any>;
    } | null = null;

    for (const candidateSnap of candidatesSnap.docs) {
      if (candidateSnap.id === uid) continue;
      const entry = (candidateSnap.data() || {}) as QueueEntry;
      if (entry.userId !== candidateSnap.id || entry.status !== 'searching') continue;
      if (getQueueExpiryMs(entry) <= nowMs) {
        staleQueueRefs.push(candidateSnap.ref);
        continue;
      }

      const candidateProfileSnap = await t.get(db.collection('players_v14').doc(candidateSnap.id));
      if (!candidateProfileSnap.exists) {
        staleQueueRefs.push(candidateSnap.ref);
        continue;
      }

      // The queue document itself prevents friendly lobby/challenge flows from
      // claiming this manager. Still verify legacy active records before pairing.
      const [candidateLobbySnap, candidateHostedSnap, candidateChallengedSnap, candidateAssociationHostedSnap, candidateAssociationChallengedSnap] = await Promise.all([
        t.get(db.collection('friendly_lobbies_v3').doc(candidateSnap.id)),
        t.get(db.collection(MATCH_COLLECTIONS.friendly).where('hostId', '==', candidateSnap.id).limit(25)),
        t.get(db.collection(MATCH_COLLECTIONS.friendly).where('challengerId', '==', candidateSnap.id).limit(25)),
        t.get(db.collection(MATCH_COLLECTIONS.association).where('hostId', '==', candidateSnap.id).limit(25)),
        t.get(db.collection(MATCH_COLLECTIONS.association).where('challengerId', '==', candidateSnap.id).limit(25)),
      ]);
      const candidateLobby = candidateLobbySnap.data() || {};
      const candidateLobbyStatus = String(candidateLobby.status || '');
      const candidateLobbyExpiry = candidateLobby.expiresAt?.toMillis?.() || ((candidateLobby.createdAt?.toMillis?.() || 0) + 5 * 60 * 1000);
      const candidateHasActiveMatch = [...candidateHostedSnap.docs, ...candidateChallengedSnap.docs, ...candidateAssociationHostedSnap.docs, ...candidateAssociationChallengedSnap.docs].some((doc: any) => {
        const status = String(doc.data()?.status || '');
        return status === 'scheduled' || status === 'starting';
      });
      if (((candidateLobbyStatus === 'searching' || candidateLobbyStatus === 'challenged') && candidateLobbyExpiry > nowMs) || candidateHasActiveMatch) {
        staleQueueRefs.push(candidateSnap.ref);
        continue;
      }

      selected = {
        ref: candidateSnap.ref,
        id: candidateSnap.id,
        entry,
        profile: candidateProfileSnap.data() || {},
      };
      break;
    }

    for (const staleRef of [...cleanupQueueRefs, ...staleQueueRefs]) t.delete(staleRef);

    if (!selected) {
      const ownName = String(ownProfile.clubName || ownProfile.displayName || 'Manager').trim() || 'Manager';
      const expiresAt = Timestamp.fromMillis(nowMs + CW_QUEUE_TTL_MS);
      t.set(ownQueueRef, {
        userId: uid,
        userName: ownName,
        status: 'searching',
        matchedWithId: null,
        matchedWithName: null,
        matchId: null,
        matchStartTime: null,
        createdAt: now,
        expiresAt,
        updatedAt: now,
      });
      return { success: true as const, status: 'searching' as const, expiresAtMs: expiresAt.toMillis() };
    }

    const opponentId = selected.id;
    const ownName = String(ownProfile.clubName || ownProfile.displayName || 'Manager').trim() || 'Manager';
    const opponentName = String(selected.profile.clubName || selected.profile.displayName || selected.entry.userName || 'Manager').trim() || 'Manager';
    const matchRef = db.collection(MATCH_COLLECTIONS.association).doc();
    const scheduledStartAt = Timestamp.fromMillis(nowMs + CW_MATCH_DELAY_MS);
    const matchId = matchRef.id;

    t.create(matchRef, {
      matchType: 'basket',
      source: 'cw-basket',
      status: 'scheduled',
      hostId: opponentId,
      hostName: opponentName,
      hostLogo: selected.profile.clubLogo || null,
      challengerId: uid,
      challengerName: ownName,
      challengerLogo: ownProfile.clubLogo || null,
      createdAt: now,
      scheduledStartAt,
      startedAt: null,
      sourceLobbyId: `cw-basket:${opponentId}:${uid}`,
    });

    t.set(selected.ref, {
      status: 'matched',
      matchedWithId: uid,
      matchedWithName: ownName,
      matchId,
      matchStartTime: scheduledStartAt.toDate().toISOString(),
      scheduledStartAt,
      updatedAt: now,
    }, { merge: true });

    t.set(ownQueueRef, {
      userId: uid,
      userName: ownName,
      status: 'matched',
      matchedWithId: opponentId,
      matchedWithName: opponentName,
      matchId,
      matchStartTime: scheduledStartAt.toDate().toISOString(),
      scheduledStartAt,
      createdAt: now,
      expiresAt: null,
      updatedAt: now,
    });

    return {
      success: true as const,
      status: 'matched' as const,
      matchId,
      matchedWithId: opponentId,
      matchedWithName: opponentName,
      matchStartTime: scheduledStartAt.toDate().toISOString(),
    };
  });
}

export async function cancelCwBasketQueueAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const queueRef = db.collection('cw_basket_v2').doc(uid);

  await db.runTransaction(async (t: any) => {
    const snap = await t.get(queueRef);
    if (!snap.exists) return;
    const entry = snap.data() || {};
    if (entry.userId !== uid) throw new Error('FORBIDDEN');
    if (entry.status === 'matched') throw new Error('CW_MATCH_ALREADY_ASSIGNED');
    if (entry.status !== 'searching') throw new Error('CW_QUEUE_NOT_ACTIVE');
    t.delete(queueRef);
  });

  return { success: true as const };
}
