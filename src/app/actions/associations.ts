'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const text = (value: unknown, max = 80) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isoNow = () => new Date().toISOString();

function requestsOf(data: any): any[] {
  if (Array.isArray(data?.requests)) return data.requests.filter((item: any) => item && typeof item === 'object');
  if (!data?.requests || typeof data.requests !== 'object') return [];
  return Object.entries(data.requests).flatMap(([uid, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? [{ ...(value as any), uid: text((value as any).uid, 128) || uid }]
      : []
  );
}

function membersOf(data: any): any[] {
  const source = Array.isArray(data?.membersData) && data.membersData.length
    ? data.membersData
    : (Array.isArray(data?.members) ? data.members.map((uid: string, index: number) => ({
        uid,
        name: data?.memberNames?.[index] || 'Manager',
        joinedAt: data?.createdAt?.toDate?.()?.toISOString?.() || isoNow(),
        role: uid === data?.ownerId ? 'owner' : uid === data?.deputyId ? 'deputy' : 'member',
      })) : []);
  const seen = new Set<string>();
  return source.filter((member: any) => {
    const uid = text(member?.uid, 128);
    if (!uid || seen.has(uid)) return false;
    seen.add(uid);
    return true;
  });
}

function assertJoinPermission(profile: any) {
  const premium = profile?.isPremium === true;
  const tier = Number(profile?.activeLicenseTier);
  if (!premium && !(Number.isFinite(tier) && tier <= 3 && tier >= 1)) throw new Error('JOIN_LICENSE_REQUIRED');
  const lastJoin = profile?.lastJoinedAssocAt ? new Date(profile.lastJoinedAssocAt).getTime() : 0;
  if (Number.isFinite(lastJoin) && Date.now() < lastJoin + COOLDOWN_MS) throw new Error('ASSOCIATION_JOIN_COOLDOWN');
}

export async function createAssociationAction(idToken: string, name: string, description: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const safeName = text(name, 40);
    const safeDescription = text(description, 500);
    if (safeName.length < 3) throw new Error('ASSOCIATION_NAME_TOO_SHORT');
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    const assocRef = db.collection('associations_v4').doc();
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const profile = profileSnap.data() || {};
      if (profile.associationId) throw new Error('ALREADY_IN_ASSOCIATION');
      if (profile.pendingAssociationId) throw new Error('ASSOCIATION_REQUEST_PENDING');
      const lastJoin = profile.lastJoinedAssocAt ? new Date(profile.lastJoinedAssocAt).getTime() : 0;
      if (Number.isFinite(lastJoin) && Date.now() < lastJoin + COOLDOWN_MS) throw new Error('ASSOCIATION_JOIN_COOLDOWN');
      const premium = profile.isPremium === true;
      const tier = Number(profile.activeLicenseTier);
      if (!premium && tier !== 1) throw new Error('CREATE_LICENSE_REQUIRED');
      const crystals = Number(profile.crystals || 0);
      if (!Number.isFinite(crystals) || crystals < 500) throw new Error('INSUFFICIENT_CRYSTALS');
      const now = isoNow();
      const displayName = text(profile.displayName, 80) || 'Manager';
      tx.create(assocRef, {
        id: assocRef.id,
        name: safeName,
        description: safeDescription,
        ownerId: uid,
        ownerName: displayName,
        deputyId: null,
        members: [uid],
        memberNames: [displayName],
        membersData: [{ uid, name: displayName, joinedAt: now, role: 'owner' }],
        requests: [],
        news: [{ type: 'join', userName: displayName, timestamp: now }],
        level: 1,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(profileRef, { associationId: assocRef.id, lastJoinedAssocAt: now, crystals: crystals - 500, updatedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection('economy_transactions').doc(`association_create_${uid}_${assocRef.id}`), {
        userId: uid, amount: -500, currency: 'crystals', type: 'ASSOCIATION_CREATE', referenceId: assocRef.id,
        balanceBefore: crystals, balanceAfter: crystals - 500, timestamp: FieldValue.serverTimestamp(),
      });
    });
    return { success: true, associationId: assocRef.id };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_CREATE_FAILED' }; }
}

export async function requestAssociationMembershipAction(idToken: string, associationId: string, displayName?: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    if (!associationId || associationId.length > 128) throw new Error('INVALID_ASSOCIATION_ID');
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    const assocRef = db.collection('associations_v4').doc(associationId);
    await db.runTransaction(async (tx) => {
      const [profileSnap, assocSnap] = await Promise.all([tx.get(profileRef), tx.get(assocRef)]);
      if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      if (!assocSnap.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const profile = profileSnap.data() || {};
      const assoc = assocSnap.data() || {};
      if (profile.associationId || (Array.isArray(assoc.members) && assoc.members.includes(uid))) throw new Error('ALREADY_IN_ASSOCIATION');
      if (profile.pendingAssociationId) throw new Error('ASSOCIATION_REQUEST_PENDING');
      assertJoinPermission(profile);
      const requests = requestsOf(assoc);
      if (requests.some((request) => request.uid === uid)) throw new Error('ASSOCIATION_REQUEST_PENDING');
      requests.push({ uid, name: text(displayName, 80) || text(profile.displayName, 80) || 'Manager' });
      tx.update(assocRef, { requests, updatedAt: FieldValue.serverTimestamp() });
      tx.update(profileRef, { pendingAssociationId: associationId, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_REQUEST_FAILED' }; }
}

export async function cancelAssociationRequestAction(idToken: string, associationId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    const assocRef = db.collection('associations_v4').doc(associationId);
    await db.runTransaction(async (tx) => {
      const [profileSnap, assocSnap] = await Promise.all([tx.get(profileRef), tx.get(assocRef)]);
      if (!profileSnap.exists || !assocSnap.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const requests = requestsOf(assocSnap.data());
      const next = requests.filter((request) => request.uid !== uid);
      if (next.length === requests.length) throw new Error('ASSOCIATION_REQUEST_NOT_FOUND');
      tx.update(assocRef, { requests: next, updatedAt: FieldValue.serverTimestamp() });
      if (profileSnap.data()?.pendingAssociationId === associationId) tx.update(profileRef, { pendingAssociationId: null, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_CANCEL_FAILED' }; }
}

export async function processAssociationRequestAction(idToken: string, associationId: string, applicantId: string, accept: boolean) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const assocRef = db.collection('associations_v4').doc(associationId);
    const actorRef = db.collection('players_v14').doc(uid);
    const applicantRef = db.collection('players_v14').doc(applicantId);
    await db.runTransaction(async (tx) => {
      const [assocSnap, actorSnap, applicantSnap] = await Promise.all([tx.get(assocRef), tx.get(actorRef), tx.get(applicantRef)]);
      if (!assocSnap.exists || !actorSnap.exists || !applicantSnap.exists) throw new Error('ASSOCIATION_OR_PLAYER_NOT_FOUND');
      const assoc = assocSnap.data() || {};
      if (assoc.ownerId !== uid && assoc.deputyId !== uid) throw new Error('FORBIDDEN');
      const requests = requestsOf(assoc);
      const applicant = requests.find((request) => request.uid === applicantId);
      if (!applicant) throw new Error('ASSOCIATION_REQUEST_NOT_FOUND');
      const applicantData = applicantSnap.data() || {};
      if (applicantData.pendingAssociationId && applicantData.pendingAssociationId !== associationId) throw new Error('APPLICANT_HAS_OTHER_PENDING_REQUEST');
      const now = isoNow();
      const remaining = requests.filter((request) => request.uid !== applicantId);
      if (accept) {
        if (applicantData.associationId) throw new Error('APPLICANT_ALREADY_IN_ASSOCIATION');
        assertJoinPermission(applicantData);
        const members = membersOf(assoc);
        if (members.some((member) => member.uid === applicantId)) throw new Error('ALREADY_ASSOCIATION_MEMBER');
        const member = { uid: applicantId, name: text(applicant.name, 80) || text(applicantData.displayName, 80) || 'Manager', joinedAt: now, role: 'member' };
        members.push(member);
        tx.update(assocRef, {
          members: members.map((item) => item.uid),
          memberNames: members.map((item) => item.name),
          membersData: members,
          requests: remaining,
          news: FieldValue.arrayUnion({ type: 'join', userName: member.name, timestamp: now }),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(applicantRef, { associationId, pendingAssociationId: null, lastJoinedAssocAt: now, updatedAt: FieldValue.serverTimestamp() });
      } else {
        tx.update(assocRef, { requests: remaining, updatedAt: FieldValue.serverTimestamp() });
        if (applicantData.pendingAssociationId === associationId) tx.update(applicantRef, { pendingAssociationId: null, updatedAt: FieldValue.serverTimestamp() });
      }
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_REQUEST_PROCESS_FAILED' }; }
}

export async function leaveAssociationAction(idToken: string, associationId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const assocRef = db.collection('associations_v4').doc(associationId);
    const profileRef = db.collection('players_v14').doc(uid);
    await db.runTransaction(async (tx) => {
      const [assocSnap, profileSnap] = await Promise.all([tx.get(assocRef), tx.get(profileRef)]);
      if (!assocSnap.exists || !profileSnap.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const assoc = assocSnap.data() || {};
      if (profileSnap.data()?.associationId && profileSnap.data()?.associationId !== associationId) throw new Error('ASSOCIATION_PROFILE_MISMATCH');
      if (assoc.ownerId === uid) throw new Error('OWNER_MUST_DISBAND_ASSOCIATION');
      const members = membersOf(assoc);
      const member = members.find((item) => item.uid === uid);
      if (!member) throw new Error('NOT_ASSOCIATION_MEMBER');
      const joinedAt = new Date(member.joinedAt || 0).getTime();
      if (Number.isFinite(joinedAt) && Date.now() < joinedAt + COOLDOWN_MS) throw new Error('ASSOCIATION_LEAVE_COOLDOWN');
      const remaining = members.filter((item) => item.uid !== uid);
      const name = text(member.name, 80) || 'Manager';
      tx.update(assocRef, {
        members: remaining.map((item) => item.uid), memberNames: remaining.map((item) => item.name), membersData: remaining,
        ...(assoc.deputyId === uid ? { deputyId: null } : {}),
        news: FieldValue.arrayUnion({ type: 'leave', userName: name, timestamp: isoNow() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(profileRef, { associationId: null, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_LEAVE_FAILED' }; }
}

export async function kickAssociationMemberAction(idToken: string, associationId: string, memberId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const assocRef = db.collection('associations_v4').doc(associationId);
    const actorRef = db.collection('players_v14').doc(uid);
    const targetRef = db.collection('players_v14').doc(memberId);
    await db.runTransaction(async (tx) => {
      const [assocSnap, actorSnap, targetSnap] = await Promise.all([tx.get(assocRef), tx.get(actorRef), tx.get(targetRef)]);
      if (!assocSnap.exists || !actorSnap.exists || !targetSnap.exists) throw new Error('ASSOCIATION_OR_PLAYER_NOT_FOUND');
      const assoc = assocSnap.data() || {};
      if (assoc.ownerId !== uid && assoc.deputyId !== uid) throw new Error('FORBIDDEN');
      if (memberId === uid || memberId === assoc.ownerId) throw new Error('CANNOT_KICK_THIS_MEMBER');
      const members = membersOf(assoc);
      const target = members.find((item) => item.uid === memberId);
      const targetAssociationId = targetSnap.data()?.associationId;
      if (!target || (targetAssociationId && targetAssociationId !== associationId)) throw new Error('NOT_ASSOCIATION_MEMBER');
      const remaining = members.filter((item) => item.uid !== memberId);
      tx.update(assocRef, {
        members: remaining.map((item) => item.uid), memberNames: remaining.map((item) => item.name), membersData: remaining,
        ...(assoc.deputyId === memberId ? { deputyId: null } : {}),
        news: FieldValue.arrayUnion({ type: 'kick', userName: text(target.name, 80) || 'Manager', timestamp: isoNow() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(targetRef, { associationId: null, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_KICK_FAILED' }; }
}

export async function setAssociationDeputyAction(idToken: string, associationId: string, memberId: string | null) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const assocRef = db.collection('associations_v4').doc(associationId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(assocRef);
      if (!snap.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const assoc = snap.data() || {};
      if (assoc.ownerId !== uid) throw new Error('FORBIDDEN');
      const members = membersOf(assoc);
      if (memberId && !members.some((member) => member.uid === memberId)) throw new Error('DEPUTY_MUST_BE_MEMBER');
      const updated = members.map((member) => ({ ...member, role: member.uid === assoc.ownerId ? 'owner' : member.uid === memberId ? 'deputy' : 'member' }));
      const target = members.find((member) => member.uid === memberId);
      tx.update(assocRef, {
        deputyId: memberId,
        membersData: updated,
        news: FieldValue.arrayUnion({ type: memberId ? 'appoint_deputy' : 'remove_deputy', userName: text(target?.name, 80) || 'Manager', timestamp: isoNow() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_DEPUTY_FAILED' }; }
}

export async function disbandAssociationAction(idToken: string, associationId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const assocRef = db.collection('associations_v4').doc(associationId);
    await db.runTransaction(async (tx) => {
      const assocSnap = await tx.get(assocRef);
      if (!assocSnap.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const assoc = assocSnap.data() || {};
      if (assoc.ownerId !== uid) throw new Error('FORBIDDEN');
      const members = membersOf(assoc);
      if (members.length > 400) throw new Error('ASSOCIATION_TOO_LARGE_TO_DISBAND');
      const refs = members.map((member) => db.collection('players_v14').doc(member.uid));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      snapshots.forEach((snap, index) => {
        if (snap.exists && snap.data()?.associationId === associationId) {
          tx.update(refs[index], { associationId: null, updatedAt: FieldValue.serverTimestamp() });
        }
      });
      tx.delete(assocRef);
    });
    return { success: true };
  } catch (error: any) { return { success: false, error: error?.message || 'ASSOCIATION_DISBAND_FAILED' }; }
}
