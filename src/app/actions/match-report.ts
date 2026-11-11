'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { MATCH_REPORT_COLLECTIONS } from '@/app/lib/match-storage';

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
    const participant = match.homeId === uid || match.awayId === uid || match.hostId === uid || match.challengerId === uid;
    let rankParticipant = false;
    if (!participant && (match.homeRank != null || match.awayRank != null)) {
      const profile = await db.collection('players_v14').doc(uid).get();
      const rank = Number(profile.data()?.rank);
      rankParticipant = Number.isFinite(rank) && (rank === Number(match.homeRank) || rank === Number(match.awayRank));
    }
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
    const isParticipant =
      m.homeId === uid || m.awayId === uid ||
      String(m.homeUid || '') === uid || String(m.awayUid || '') === uid;

    // Rank-based league records need the player's rank to be resolved from the profile.
    let rankParticipant = false;
    if (!isParticipant && (m.homeRank != null || m.awayRank != null)) {
      const playerSnap = await db.collection('players_v14').doc(uid).get();
      const rank = Number(playerSnap.data()?.rank);
      rankParticipant = Number.isFinite(rank) && (rank === Number(m.homeRank) || rank === Number(m.awayRank));
    }

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
