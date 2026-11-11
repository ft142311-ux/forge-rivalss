'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { applyPlayerCareToOwnedPlayers, recoverAssignedSquadPlayers } from '@/app/lib/player-care-utils';

type CareMode = 'energy' | 'form';
type Currency = 'credits' | 'crystals';

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,100}$/.test(value);
}

async function commitCarePurchase(
  uid: string,
  operationId: string,
  currency: Currency,
  cost: number,
  description: string,
  mutate: (profile: Record<string, any>) => { profilePatch: Record<string, unknown>; result: Record<string, unknown> }
) {
  const db = getAdminDb();
  const profileRef = db.collection('players_v14').doc(uid);
  const ledgerRef = db.collection('economy_transactions').doc(`player_care_${uid}_${operationId}`);

  return db.runTransaction(async (tx) => {
    const [profileSnap, ledgerSnap] = await Promise.all([tx.get(profileRef), tx.get(ledgerRef)]);
    if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    if (ledgerSnap.exists) return { success: true, duplicate: true, ...(ledgerSnap.data()?.result || {}) };

    const profile = profileSnap.data() || {};
    const balance = safeNumber(profile[currency]);
    if (balance < cost) throw new Error('INSUFFICIENT_FUNDS');

    const mutation = mutate(profile);
    const nextBalance = balance - cost;
    tx.update(profileRef, {
      ...mutation.profilePatch,
      [currency]: nextBalance,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { ...mutation.result, [currency]: nextBalance };
    tx.create(ledgerRef, {
      userId: uid,
      amount: -cost,
      currency,
      type: 'PLAYER_CARE',
      referenceId: operationId,
      description,
      balanceBefore: balance,
      balanceAfter: nextBalance,
      result,
      timestamp: FieldValue.serverTimestamp(),
    });
    return { success: true, duplicate: false, ...result };
  });
}

/** Restore one owned player's energy or improve their form. Costs and caps are server-authoritative. */
export async function purchasePlayerCareAction(
  idToken: string,
  playerId: string,
  mode: CareMode,
  operationId: string,
) {
  try {
    const { uid } = await requireServerActor(idToken);
    if (typeof playerId !== 'string' || playerId.length < 1 || playerId.length > 128) throw new Error('INVALID_PLAYER_ID');
    if (mode !== 'energy' && mode !== 'form') throw new Error('INVALID_CARE_MODE');
    if (!validOperationId(operationId)) throw new Error('INVALID_OPERATION_ID');

    const cost = mode === 'energy' ? 5_000 : 10_000;
    return await commitCarePurchase(uid, operationId, 'credits', cost,
      mode === 'energy' ? 'Player energy recovery' : 'Player form boost',
      (profile) => {
        const players = Array.isArray(profile.ownedPlayers) ? profile.ownedPlayers : [];
        const mutation = applyPlayerCareToOwnedPlayers(
          players,
          playerId,
          mode,
          safeNumber(profile.managerSkills?.medical),
        );
        return {
          profilePatch: { ownedPlayers: mutation.updatedPlayers },
          result: { playerId, value: mutation.value, field: mutation.field },
        };
      }
    );
  } catch (error: any) {
    return { success: false, error: error?.message || 'PLAYER_CARE_FAILED' };
  }
}

/** Restore all currently assigned squad players to 100 energy for a fixed fee. */
export async function recoverSquadEnergyAction(
  idToken: string,
  currency: Currency,
  operationId: string,
) {
  try {
    const { uid } = await requireServerActor(idToken);
    if (currency !== 'credits' && currency !== 'crystals') throw new Error('INVALID_CURRENCY');
    if (!validOperationId(operationId)) throw new Error('INVALID_OPERATION_ID');
    const cost = currency === 'credits' ? 75_000 : 150;

    return await commitCarePurchase(uid, operationId, currency, cost,
      currency === 'credits' ? 'Squad energy recovery' : 'Squad instant energy regeneration',
      (profile) => {
        const players = Array.isArray(profile.ownedPlayers) ? profile.ownedPlayers : [];
        const lineup = profile.lineup && typeof profile.lineup === 'object' ? profile.lineup : {};
        const mutation = recoverAssignedSquadPlayers(players, lineup);
        return {
          profilePatch: { ownedPlayers: mutation.updatedPlayers },
          result: { recoveredPlayers: mutation.recoveredPlayers },
        };
      }
    );
  } catch (error: any) {
    return { success: false, error: error?.message || 'SQUAD_RECOVERY_FAILED' };
  }
}
