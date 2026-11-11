'use server';

import { FieldPath, FieldValue, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { assertCronSecret } from '@/lib/server-cron-auth';
import { getFoundationManagerRef } from './foundation-manager-ref';
import { FOUNDATION_COLLECTIONS, DEFAULT_TACTICS } from '@/game/foundation/config';
import { calculateDailyPlayerSalary, salaryPeriodKey } from '@/game/foundation/economy';
import { calculateMarketValue, calculateSalary } from '@/game/foundation/player-system';
import { deterministicDailyEvent } from '@/game/foundation/events';
import { clamp } from '@/game/foundation/player-system';

const CYCLE_VERSION = 1;
const STAFF_SALARY_SHARE = 1;

function moscowDateKey(now = new Date()) { return salaryPeriodKey(now); }

function normalizePlayers(players: any[]) {
  return players.map((player: any) => {
    const role = player.currentRole || player.role || 'Support';
    const normalized = {
      ...player,
      currentRole: role,
      form: clamp(Number(player.form ?? 100)),
      fatigue: clamp(Number(player.fatigue ?? 100)),
      tilt: clamp(Number(player.tilt ?? 0)),
      proStats: { ...(player.proStats || {}) },
      proTalents: { ...(player.proTalents || {}) },
      trainingProgress: { ...(player.trainingProgress || {}) },
      skillCaps: { ...(player.skillCaps || {}) },
      skillInclinations: { ...(player.skillInclinations || {}) },
      trainingPropensity: Number.isFinite(Number(player.trainingPropensity)) ? Number(player.trainingPropensity) : 50,
      physical: Number.isFinite(Number(player.physical)) ? Number(player.physical) : 50,
      resilience: Number.isFinite(Number(player.resilience)) ? Number(player.resilience) : 50,
    };
    const salary = Number(player.salary);
    normalized.salary = Number.isFinite(salary) && salary > 0 ? salary : calculateSalary(normalized);
    normalized.marketValue = calculateMarketValue(normalized);
    normalized.price = normalized.marketValue;
    return normalized;
  });
}

async function processManager(db: any, ref: DocumentReference, now: Date) {
  const periodKey = moscowDateKey(now);
  return db.runTransaction(async (t: Transaction) => {
    const snap = await t.get(ref);
    if (!snap.exists) return { processed: false };
    const data = snap.data() || {};
    const cycleRef = db.collection(FOUNDATION_COLLECTIONS.cycles).doc(`${ref.id}_${periodKey}`);
    const cycleSnap: any = await t.get(cycleRef as any);
    if (cycleSnap.exists) return { processed: false };

    const players = normalizePlayers(Array.isArray(data.ownedPlayers) ? data.ownedPlayers : []);
    const grossPlayerSalary = calculateDailyPlayerSalary(players);
    const staff = data.staff && typeof data.staff === 'object' ? data.staff : {};
    const staffSalary = Object.values(staff).reduce((sum: number, member: any) => sum + (member ? Math.max(0, Number(member.salary || 0)) : 0), 0) * STAFF_SALARY_SHARE;
    const totalDue = grossPlayerSalary + staffSalary;
    const before = Math.max(0, Number(data.credits || 0));
    const paid = Math.min(before, totalDue);
    const unpaid = totalDue - paid;
    const event = deterministicDailyEvent({ ...data, id: ref.id, ownedPlayers: players, credits: before, crystals: Number(data.crystals || 0) }, periodKey);
    // The daily event is generated at the 00:00 cycle but is NOT applied here.
    // The manager must resolve it once through the server action; this prevents
    // the same event from being applied twice (cycle + UI choice).
    const eventApplied = false;
    const eventPlayers = players;

    const updates: any = {
      ownedPlayers: eventPlayers,
      credits: before - paid,
      foundationVersion: CYCLE_VERSION,
      foundationCycle: {
        lastProcessedDate: periodKey,
        playerSalary: grossPlayerSalary,
        staffSalary,
        amountDue: totalDue,
        paid,
        unpaid,
        eventId: event?.id || null,
        processedAt: now.toISOString(),
      },
      fans: data.fans || { mood: 50, communitySize: 1000, attendanceLast3: [], attendance: 0 },
      tactics: { ...DEFAULT_TACTICS, ...(data.tactics || {}), direction: ['easy','mid','hard'].includes(String(data.tactics?.direction)) ? data.tactics.direction : DEFAULT_TACTICS.direction },
      updatedAt: FieldValue.serverTimestamp(),
    };
    t.update(ref, updates);
    t.set(cycleRef, { userId: ref.id, date: periodKey, paid, playerSalary: grossPlayerSalary, staffSalary, eventId: event?.id || null, createdAt: FieldValue.serverTimestamp() });
    const txRef = db.collection(FOUNDATION_COLLECTIONS.economy).doc(`foundation_salary_${ref.id}_${periodKey}`);
    t.set(txRef, { userId: ref.id, amount: -paid, currency: 'credits', type: 'DAILY_SALARY', description: 'Daily player and staff salary at 00:00 MSK', playerSalary: grossPlayerSalary, staffSalary, amountDue: totalDue, paid, unpaid, periodKey, timestamp: FieldValue.serverTimestamp() });
    if (event) {
      const eventRef = db.collection(FOUNDATION_COLLECTIONS.events).doc(`${ref.id}_${periodKey}`);
      t.set(eventRef, { userId: ref.id, date: periodKey, event, applied: eventApplied, resolvedAt: null, createdAt: FieldValue.serverTimestamp() });
    }
    return { processed: true, paid, unpaid, playerSalary: grossPlayerSalary, staffSalary, eventId: event?.id || null };
  });
}

export async function runFoundationDailyCycle(cronSecret: string) {
  assertCronSecret(cronSecret);
  const db = getAdminDb();
  const now = new Date();
  const managers = db.collection(FOUNDATION_COLLECTIONS.managers);
  const pageSize = 200;
  let cursor: any = null;
  let scanned = 0;
  let pages = 0;
  let processed = 0;
  let paid = 0;
  let unpaid = 0;
  const errors: Array<{ managerId: string; error: string }> = [];

  // Stable document-ID pagination prevents managers after the first 500 from
  // being silently skipped. Each manager transaction remains independently
  // idempotent through the existing per-date cycle document.
  while (true) {
    let query = managers.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    pages++;
    scanned += page.size;

    for (const doc of page.docs) {
      try {
        const result = await processManager(db, doc.ref, now);
        if (result.processed) {
          processed++;
          paid += result.paid || 0;
          unpaid += result.unpaid || 0;
        }
      } catch (error: any) {
        const message = String(error?.message || 'FOUNDATION_MANAGER_CYCLE_FAILED');
        errors.push({ managerId: doc.id, error: message.slice(0, 240) });
        console.warn(`[FOUNDATION] cycle failed for ${doc.id}`, error);
      }
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }

  return {
    success: errors.length === 0,
    date: moscowDateKey(now),
    scanned,
    pages,
    processed,
    paid,
    unpaid,
    failed: errors.length,
    errors: errors.slice(0, 50),
    version: CYCLE_VERSION,
  };
}

export async function syncFoundationForManager(idToken: string) {
  const { requireServerActor } = await import('@/lib/server-auth');
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const ref = getFoundationManagerRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return { success: false, error: 'PLAYER_NOT_FOUND' };
  const data = snap.data() || {};
  const players = normalizePlayers(Array.isArray(data.ownedPlayers) ? data.ownedPlayers : []);
  await ref.update({
    ownedPlayers: players,
    foundationVersion: CYCLE_VERSION,
    tactics: { ...DEFAULT_TACTICS, ...(data.tactics || {}) },
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true, migrated: true };
}
