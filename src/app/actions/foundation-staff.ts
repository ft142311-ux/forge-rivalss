'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getFoundationManagerRef } from './foundation-manager-ref';
import { requireServerActor } from '@/lib/server-auth';
import { generateStaffMember } from '@/app/lib/moba-data';
import { FOUNDATION_COLLECTIONS } from '@/game/foundation/config';

const STAFF_ROLES = ['recruiter', 'coach', 'analyst', 'scout', 'doctor', 'financier'] as const;
type StaffRole = typeof STAFF_ROLES[number];

const BUILDING_REQUIREMENTS: Partial<Record<StaffRole, string>> = {
  coach: 'bootcamp',
  analyst: 'hq',
  scout: 'academy',
  doctor: 'medical',
  financier: 'hq',
};

const ROLE_LABELS: Record<StaffRole, string> = {
  coach: 'Главный тренер',
  analyst: 'Аналитик',
  scout: 'Скаут',
  doctor: 'Спортивный врач',
  financier: 'Финансовый директор',
  recruiter: 'Кадровик',
};

function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function cleanRole(value: unknown): StaffRole {
  const role = String(value || '');
  if (!STAFF_ROLES.includes(role as StaffRole)) throw new Error('INVALID_STAFF_ROLE');
  return role as StaffRole;
}

function staffCount(staff: Record<string, any>) {
  return Object.values(staff || {}).filter(Boolean).length;
}

function staffCapacity(hq: any) {
  const level = Math.max(1, Number(hq?.hrLevel || 1));
  // HR level 1: recruiter + one specialist. Each further level adds one place.
  return level + 1;
}

function buildingAvailable(data: any, building: string) {
  if (building === 'bootcamp') return Number(data.bootcamp?.bootcampLevel || 0) > 0;
  if (building === 'academy') return Number(data.academy?.scoutsLevel || 0) > 0;
  if (building === 'medical') return Number(data.medical?.massageLevel || 0) > 0;
  if (building === 'hq') return Number(data.hq?.hrLevel || 0) > 0;
  return false;
}

function errorOf(e: any) {
  return e?.message || 'FOUNDATION_STAFF_FAILED';
}

export async function getFoundationStaffCandidatesAction(idToken: string, roleValue: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const role = cleanRole(roleValue);
    const db = getAdminDb();
    const managerRef = getFoundationManagerRef(db, uid);
    const managerSnap = await managerRef.get();
    if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    const data = managerSnap.data() || {};
    const staff = (data.staff || {}) as Record<string, any>;

    if (role !== 'recruiter' && !staff.recruiter) throw new Error('RECRUITER_REQUIRED');
    if (staff[role]) throw new Error('STAFF_ROLE_OCCUPIED');

    const building = BUILDING_REQUIREMENTS[role];
    if (building && !buildingAvailable(data, building)) throw new Error('REQUIRED_BUILDING_MISSING');
    if (staffCount(staff) >= staffCapacity(data.hq)) throw new Error('HR_CAPACITY_REACHED');

    const today = dayKey();
    const candidateRef = db.collection(FOUNDATION_COLLECTIONS.staff).doc(`candidate_${uid}_${today}_${role}`);
    const candidateSnap = await candidateRef.get();

    if (candidateSnap.exists) {
      return { success: true, role, roleLabel: ROLE_LABELS[role], candidate: candidateSnap.data()?.candidate || null, generatedToday: true };
    }

    // One candidate per role/place per Moscow day. The candidate is persisted,
    // so refreshing the screen does not generate a different person.
    const candidate = { ...generateStaffMember(role === 'recruiter' ? 'coach' : role), role };
    await candidateRef.set({
      kind: 'candidate',
      userId: uid,
      role,
      day: today,
      candidate,
      status: 'available',
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, role, roleLabel: ROLE_LABELS[role], candidate, generatedToday: true };
  } catch (e) {
    return { success: false, error: errorOf(e) };
  }
}

export async function hireFoundationStaffAction(idToken: string, roleValue: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const role = cleanRole(roleValue);
    const db = getAdminDb();
    const managerRef = getFoundationManagerRef(db, uid);
    const candidateRef = db.collection(FOUNDATION_COLLECTIONS.staff).doc(`candidate_${uid}_${dayKey()}_${role}`);

    return await db.runTransaction(async t => {
      const [managerSnap, candidateSnap] = await Promise.all([t.get(managerRef), t.get(candidateRef)]);
      if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      if (!candidateSnap.exists) throw new Error('CANDIDATE_NOT_FOUND');

      const data = managerSnap.data() || {};
      const staff = { ...(data.staff || {}) } as Record<string, any>;
      if (role !== 'recruiter' && !staff.recruiter) throw new Error('RECRUITER_REQUIRED');
      if (staff[role]) throw new Error('STAFF_ROLE_OCCUPIED');
      if (staffCount(staff) >= staffCapacity(data.hq)) throw new Error('HR_CAPACITY_REACHED');

      const building = BUILDING_REQUIREMENTS[role];
      if (building && !buildingAvailable(data, building)) throw new Error('REQUIRED_BUILDING_MISSING');

      const candidateData = candidateSnap.data() || {};
      if (candidateData.status !== 'available') throw new Error('CANDIDATE_UNAVAILABLE');
      const candidate = candidateData.candidate;
      if (!candidate) throw new Error('CANDIDATE_DATA_MISSING');

      const cost = 50000;
      const balance = Number(data.credits || 0);
      if (balance < cost) throw new Error('INSUFFICIENT_FUNDS');

      const hired = {
        ...candidate,
        hiredAt: new Date().toISOString(),
        status: 'active',
      };
      staff[role] = hired;

      t.update(managerRef, {
        credits: balance - cost,
        staff,
        updatedAt: FieldValue.serverTimestamp(),
      });
      t.update(candidateRef, {
        status: 'hired',
        hiredStaffId: hired.id,
        hiredAt: FieldValue.serverTimestamp(),
      });

      const txRef = db.collection(FOUNDATION_COLLECTIONS.economy).doc();
      t.set(txRef, {
        userId: uid,
        amount: -cost,
        currency: 'credits',
        type: 'STAFF_HIRE',
        referenceId: hired.id,
        description: `Hire ${role}`,
        timestamp: FieldValue.serverTimestamp(),
      });

      return { success: true, role, staff: hired, cost };
    });
  } catch (e) {
    return { success: false, error: errorOf(e) };
  }
}
