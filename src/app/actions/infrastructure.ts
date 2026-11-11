'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

export type ConstructionSection = 'arena' | 'hq' | 'bootcamp' | 'academy' | 'medical';

const CONFIG: Record<ConstructionSection, { baseCost: number; baseHours: number }> = {
  arena: { baseCost: 15000, baseHours: 4 },
  hq: { baseCost: 25000, baseHours: 4 },
  bootcamp: { baseCost: 40000, baseHours: 4 },
  academy: { baseCost: 35000, baseHours: 4 },
  medical: { baseCost: 30000, baseHours: 4 },
};

const ALLOWED_IDS: Record<ConstructionSection, string[]> = {
  arena: ['pressCenterLevel', 'cafeLevel', 'shopLevel', 'screensLevel', 'parkingLevel', 'lightingLevel'],
  hq: ['hrLevel', 'financeLevel', 'scoutsLevel', 'pressOfficeLevel', 'adminLevel'],
  bootcamp: ['bootcampLevel', 'tacticsHallLevel', 'poolLevel', 'researchLevel'],
  academy: ['youthBootcampLevel', 'streamingLevel', 'scoutsLevel', 'discoLevel'],
  medical: ['physiotherapyLevel', 'massageLevel', 'psychiatristLevel', 'labLevel', 'psychologistLevel'],
};

function errorMessage(error: any) {
  return error instanceof Error ? error.message : String(error || 'CONSTRUCTION_FAILED');
}

export async function startConstructionAction(idToken: string, section: ConstructionSection, id: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    if (!CONFIG[section] || !ALLOWED_IDS[section]?.includes(id)) throw new Error('INVALID_CONSTRUCTION');

    const db = getAdminDb();
    const playerRef = db.collection('players_v14').doc(uid);

    await db.runTransaction(async (t) => {
      const snap = await t.get(playerRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const p = snap.data() || {};
      const current = Number((p[section] || {})[id] || 0);
      const sectionState = { ...(p[section] || {}) };
      const finishes = { ...(sectionState.constructionFinishes || {}) };
      const starts = { ...(sectionState.constructionStarts || {}) };

      // One active project per infrastructure section/tab.
      const now = Date.now();
      for (const [activeId, finish] of Object.entries(finishes)) {
        const finishMs = new Date(String(finish)).getTime();
        if (Number.isFinite(finishMs) && finishMs > now) {
          throw new Error('CONSTRUCTION_ALREADY_IN_PROGRESS');
        }
      }

      const nextLevel = current + 1;
      const cost = CONFIG[section].baseCost * nextLevel;
      const credits = Number(p.credits || 0);
      if (credits < cost) throw new Error('INSUFFICIENT_FUNDS');

      const startIso = new Date().toISOString();
      const finishIso = new Date(Date.now() + CONFIG[section].baseHours * nextLevel * 3600000).toISOString();
      const targets = { ...(sectionState.constructionTargets || {}) };
      const accelerated = { ...(sectionState.isAccelerated || {}) };

      starts[id] = startIso;
      finishes[id] = finishIso;
      targets[id] = nextLevel;
      accelerated[id] = false;

      sectionState.constructionStarts = starts;
      sectionState.constructionFinishes = finishes;
      sectionState.constructionTargets = targets;
      sectionState.isAccelerated = accelerated;

      t.update(playerRef, {
        credits: credits - cost,
        [section]: sectionState,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const txRef = db.collection('economy_transactions').doc();
      t.set(txRef, {
        userId: uid,
        amount: -cost,
        currency: 'credits',
        type: 'INFRASTRUCTURE_CONSTRUCTION',
        referenceId: `${section}:${id}:L${nextLevel}`,
        description: `Construction ${section}/${id} level ${nextLevel}`,
        balanceBefore: credits,
        balanceAfter: credits - cost,
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function accelerateConstructionAction(idToken: string, section: string, id: string, multiplier: number) {
  try {
    const { uid } = await requireServerActor(idToken);
    if (!(section in CONFIG) || !ALLOWED_IDS[section as ConstructionSection]?.includes(id)) {
      throw new Error('INVALID_ACCELERATION_TARGET');
    }
    const allowedMultiplierPrices: Record<number, number> = { 2: 100, 4: 250, 8: 600 };
    if (!Number.isFinite(multiplier) || !Object.prototype.hasOwnProperty.call(allowedMultiplierPrices, multiplier)) {
      throw new Error('INVALID_ACCELERATION');
    }
    const serverPrice = allowedMultiplierPrices[multiplier];
    const db = getAdminDb();
    const playerRef = db.collection('players_v14').doc(uid);

    await db.runTransaction(async (t) => {
      const snap = await t.get(playerRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const p = snap.data() || {};
      const sectionState = { ...(p[section] || {}) };
      const finish = sectionState.constructionFinishes?.[id];
      const targetLevel = Number(sectionState.constructionTargets?.[id] || Number(sectionState[id] || 0) + 1);
      if (!Number.isFinite(targetLevel) || targetLevel < 1) throw new Error('INVALID_CONSTRUCTION_STATE');
      if (!finish) throw new Error('NO_ACTIVE_CONSTRUCTION');
      if (sectionState.isAccelerated?.[id]) throw new Error('CONSTRUCTION_ALREADY_ACCELERATED');

      const crystals = Number(p.crystals || 0);
      if (crystals < serverPrice) throw new Error('INSUFFICIENT_CRYSTALS');
      const remaining = Math.max(0, new Date(String(finish)).getTime() - Date.now());
      const newFinish = new Date(Date.now() + Math.ceil(remaining / multiplier)).toISOString();

      sectionState.constructionFinishes = { ...(sectionState.constructionFinishes || {}), [id]: newFinish };
      sectionState.isAccelerated = { ...(sectionState.isAccelerated || {}), [id]: true };

      t.update(playerRef, { crystals: crystals - serverPrice, [section]: sectionState, updatedAt: FieldValue.serverTimestamp() });
      const txRef = db.collection('economy_transactions').doc();
      t.set(txRef, {
        userId: uid, amount: -serverPrice, currency: 'crystals', type: 'INFRASTRUCTURE_ACCELERATION',
        referenceId: `${section}:${id}:x${multiplier}`, description: `Acceleration x${multiplier}`,
        multiplier, price: serverPrice, targetLevel, balanceBefore: crystals, balanceAfter: crystals - serverPrice, timestamp: FieldValue.serverTimestamp()
      });
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function finalizeConstructionsAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const playerRef = db.collection('players_v14').doc(uid);
    const now = Date.now();

    await db.runTransaction(async (t) => {
      const snap = await t.get(playerRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const p = snap.data() || {};
      const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };

      for (const section of Object.keys(CONFIG) as ConstructionSection[]) {
        const state = { ...(p[section] || {}) };
        const finishes = { ...(state.constructionFinishes || {}) };
        const starts = { ...(state.constructionStarts || {}) };
        const targets = { ...(state.constructionTargets || {}) };
        const accelerated = { ...(state.isAccelerated || {}) };
        let changed = false;

        for (const [id, finish] of Object.entries(finishes)) {
          if (new Date(String(finish)).getTime() > now) continue;
          const target = Number(targets[id] || Number(state[id] || 0) + 1);
          state[id] = target;
          delete finishes[id]; delete starts[id]; delete targets[id]; delete accelerated[id];
          changed = true;
        }

        if (changed) {
          state.constructionFinishes = finishes;
          state.constructionStarts = starts;
          state.constructionTargets = targets;
          state.isAccelerated = accelerated;
          updates[section] = state;
        }
      }

      if (Object.keys(updates).length > 1) t.update(playerRef, updates);
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}
