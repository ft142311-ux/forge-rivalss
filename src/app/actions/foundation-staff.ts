'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getFoundationManagerRef } from './foundation-manager-ref';
import { requireServerActor } from '@/lib/server-auth';
import { generateStaffMember } from '@/app/lib/moba-data';
import { staffCapacity } from '@/game/foundation/staff';
import { FOUNDATION_COLLECTIONS } from '@/game/foundation/config';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';
import {
  readFoundationNonNegativeInteger,
  readFoundationStaff,
  readFoundationStaffMember,
} from '@/game/foundation/guards';

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

function buildingAvailable(data: any, building: string) {
  if (building === 'bootcamp') return readFoundationNonNegativeInteger(data.bootcamp?.bootcampLevel, 'FOUNDATION_BUILDING_LEVEL_INVALID') > 0;
  if (building === 'academy') return readFoundationNonNegativeInteger(data.academy?.scoutsLevel, 'FOUNDATION_BUILDING_LEVEL_INVALID') > 0;
  if (building === 'medical') return readFoundationNonNegativeInteger(data.medical?.massageLevel, 'FOUNDATION_BUILDING_LEVEL_INVALID') > 0;
  if (building === 'hq') return readFoundationNonNegativeInteger(data.hq?.hrLevel, 'FOUNDATION_BUILDING_LEVEL_INVALID') > 0;
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
    const today = dayKey();
    const candidateRef = db.collection(FOUNDATION_COLLECTIONS.staff).doc(`candidate_${uid}_${today}_${role}`);
    // Generate outside the transaction so retries keep the persisted daily
    // candidate as the single source of truth.
    const generatedCandidate = readFoundationStaffMember(
      { ...generateStaffMember(role === 'recruiter' ? 'coach' : role), role },
      role,
    );

    return await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [managerSnap, candidateSnap] = await Promise.all([t.get(managerRef), t.get(candidateRef)]);
      if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = managerSnap.data() || {};
      const staff = readFoundationStaff(data.staff);

      if (role !== 'recruiter' && !staff.recruiter) throw new Error('RECRUITER_REQUIRED');
      if (staff[role]) throw new Error('STAFF_ROLE_OCCUPIED');

      const building = BUILDING_REQUIREMENTS[role];
      if (building && !buildingAvailable(data, building)) throw new Error('REQUIRED_BUILDING_MISSING');
      if (staffCount(staff) >= staffCapacity(data.hq)) throw new Error('HR_CAPACITY_REACHED');

      if (candidateSnap.exists) {
        const existing = candidateSnap.data() || {};
        if (existing.userId !== uid || existing.role !== role || existing.day !== today) {
          throw new Error('CANDIDATE_DATA_MISMATCH');
        }
        if (existing.status !== 'available') throw new Error('CANDIDATE_UNAVAILABLE');
        const candidate = readFoundationStaffMember(existing.candidate, role);
        return { success: true, role, roleLabel: ROLE_LABELS[role], candidate, generatedToday: true };
      }

      t.create(candidateRef, {
        kind: 'candidate',
        userId: uid,
        role,
        day: today,
        candidate: generatedCandidate,
        status: 'available',
        createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true, role, roleLabel: ROLE_LABELS[role], candidate: generatedCandidate, generatedToday: true };
    });
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
    const today = dayKey();
    const candidateRef = db.collection(FOUNDATION_COLLECTIONS.staff).doc(`candidate_${uid}_${today}_${role}`);

    return await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [managerSnap, candidateSnap] = await Promise.all([t.get(managerRef), t.get(candidateRef)]);
      if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      if (!candidateSnap.exists) throw new Error('CANDIDATE_NOT_FOUND');

      const data = managerSnap.data() || {};
      const staff = { ...readFoundationStaff(data.staff) } as Record<string, any>;
      if (role !== 'recruiter' && !staff.recruiter) throw new Error('RECRUITER_REQUIRED');
      if (staff[role]) throw new Error('STAFF_ROLE_OCCUPIED');
      if (staffCount(staff) >= staffCapacity(data.hq)) throw new Error('HR_CAPACITY_REACHED');

      const building = BUILDING_REQUIREMENTS[role];
      if (building && !buildingAvailable(data, building)) throw new Error('REQUIRED_BUILDING_MISSING');

      const candidateData = candidateSnap.data() || {};
      if (candidateData.userId !== uid || candidateData.role !== role || candidateData.day !== today) {
        throw new Error('CANDIDATE_DATA_MISMATCH');
      }
      if (candidateData.status !== 'available') throw new Error('CANDIDATE_UNAVAILABLE');
      const candidate = readFoundationStaffMember(candidateData.candidate, role);

      const cost = 50000;
      const balance = readFoundationNonNegativeInteger(data.credits, 'INVALID_BALANCE');
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

      const txRef = db.collection(FOUNDATION_COLLECTIONS.economy).doc('staff_hire_' + uid + '_' + today + '_' + role);
      t.create(txRef, {
        userId: uid,
        amount: -cost,
        currency: 'credits',
        type: 'STAFF_HIRE',
        referenceId: hired.id,
        periodKey: today,
        description: `Hire ${role}`,
        balanceBefore: balance,
        balanceAfter: balance - cost,
        timestamp: FieldValue.serverTimestamp(),
      });

      return { success: true, role, staff: hired, cost };
    });
  } catch (e) {
    return { success: false, error: errorOf(e) };
  }
}

/**
 * Dismiss the exact active staff member shown by the client.
 *
 * The expected ID prevents a stale confirmation from dismissing a replacement
 * hire in the same role. A deterministic history key makes retries idempotent.
 */
export async function dismissFoundationStaffAction(
  idToken: string,
  roleValue: string,
  expectedStaffIdValue: string,
) {
  try {
    const { uid } = await requireServerActor(idToken);
    const role = cleanRole(roleValue);
    const expectedStaffId = String(expectedStaffIdValue || '').trim();
    if (!expectedStaffId || expectedStaffId.length > 128) throw new Error('INVALID_STAFF_ID');

    const db = getAdminDb();
    const managerRef = getFoundationManagerRef(db, uid);
    const historyRef = db.collection(FOUNDATION_COLLECTIONS.staff).doc(
      `dismiss_${uid}_${role}_${encodeURIComponent(expectedStaffId)}`,
    );
    const dismissedAt = new Date().toISOString();

    return await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [managerSnap, historySnap] = await Promise.all([
        t.get(managerRef),
        t.get(historyRef),
      ]);
      if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');

      const data = managerSnap.data() || {};
      const staff = { ...readFoundationStaff(data.staff) } as Record<string, any>;
      const current = staff[role];

      if (historySnap.exists) {
        const history = historySnap.data() || {};
        if (
          history.kind !== 'staff_history' ||
          history.event !== 'dismissed' ||
          history.userId !== uid ||
          history.role !== role ||
          history.staffId !== expectedStaffId
        ) {
          throw new Error('STAFF_HISTORY_INVALID');
        }
        if (current) {
          const currentMember = readFoundationStaffMember(current, role);
          if (currentMember.id === expectedStaffId) throw new Error('STAFF_HISTORY_CONFLICT');
        }
        return { success: true, role, staffId: expectedStaffId, alreadyDismissed: true };
      }

      if (!current) throw new Error('STAFF_NOT_FOUND');
      const member = readFoundationStaffMember(current, role);
      if (member.id !== expectedStaffId) throw new Error('STAFF_CHANGED');

      staff[role] = null;
      t.update(managerRef, {
        staff,
        updatedAt: FieldValue.serverTimestamp(),
      });
      t.create(historyRef, {
        kind: 'staff_history',
        event: 'dismissed',
        userId: uid,
        staffId: member.id,
        role,
        salaryAtDismissal: member.salary,
        hiredAt: member.hiredAt ?? null,
        dismissedAt,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        role,
        staffId: member.id,
        salaryAtDismissal: member.salary,
        dismissedAt,
        alreadyDismissed: false,
      };
    });
  } catch (e) {
    return { success: false, error: errorOf(e) };
  }
}
