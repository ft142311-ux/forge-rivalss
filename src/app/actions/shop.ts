'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { generateUniquePlayer, Player, Role } from '@/app/lib/moba-data';

const ROLES: Role[] = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];
const LICENSE_COSTS: Record<number, number> = { 3: 500, 2: 1500, 1: 3000 };
const DIAMOND_PACKS: Record<number, { productId: string; price: string }> = {
  1000: { productId: 'diamond_cadet_1000', price: '4.99 USD' },
  5000: { productId: 'diamond_commander_5000', price: '19.99 USD' },
  15000: { productId: 'diamond_emperor_15000', price: '49.99 USD' },
};

const CountrySchema = z.object({
  code: z.string().min(2).max(3),
  name: z.string().min(1).max(64),
  flag: z.string().max(8),
});

const ROLE_SCHEMA = z.enum(['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support']);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'SHOP_ACTION_FAILED';
}


export async function purchaseLicenseAction(idToken: string, requestedTier: number) {
  try {
    const { uid } = await requireServerActor(idToken);
    const tier = Number(requestedTier);
    const cost = LICENSE_COSTS[tier];
    if (!cost) throw new Error('INVALID_LICENSE_TIER');

    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const current = Number(data.activeLicenseTier ?? 4);
      if (tier !== current - 1) throw new Error('LICENSE_MUST_BE_PURCHASED_SEQUENTIALLY');
      const crystals = Number(data.crystals || 0);
      if (crystals < cost) throw new Error('INSUFFICIENT_FUNDS');

      t.update(ref, {
        crystals: crystals - cost,
        activeLicenseTier: tier,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, {
        userId: uid,
        amount: -cost,
        currency: 'crystals',
        type: 'LICENSE_PURCHASE',
        referenceId: `license_${tier}`,
        description: `License tier ${tier}`,
        balanceBefore: crystals,
        balanceAfter: crystals - cost,
        timestamp: FieldValue.serverTimestamp(),
      });
      return { success: true, tier, crystals: crystals - cost };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function purchasePremiumShopAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const now = Date.now();
      const currentUntil = data.premiumUntil ? new Date(String(data.premiumUntil)).getTime() : 0;
      if (data.isPremium === true && currentUntil > now) throw new Error('PREMIUM_ALREADY_ACTIVE');

      const cost = 5000;
      const crystals = Number(data.crystals || 0);
      if (crystals < cost) throw new Error('INSUFFICIENT_FUNDS');
      const premiumUntil = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

      t.update(ref, {
        crystals: crystals - cost,
        isPremium: true,
        premiumUntil,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, {
        userId: uid,
        amount: -cost,
        currency: 'crystals',
        type: 'PREMIUM_PURCHASE',
        referenceId: 'premium_30d',
        description: '30 Days Elite Status',
        balanceBefore: crystals,
        balanceAfter: crystals - cost,
        timestamp: FieldValue.serverTimestamp(),
      });
      return { success: true, premiumUntil, crystals: crystals - cost };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

/**
 * Diamond packs are real-money products. While the project is running against
 * the Firebase emulator, the pack is completed immediately so the shop is
 * fully testable. In production we create a pending order instead; a payment
 * provider/webhook must mark it paid before crystals are granted.
 */
export async function purchaseDiamondPackAction(idToken: string, amount: number) {
  try {
    const { uid } = await requireServerActor(idToken);
    const pack = DIAMOND_PACKS[Number(amount)];
    if (!pack) throw new Error('INVALID_DIAMOND_PACK');
    const db = getAdminDb();
    const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);

    if (!isEmulator) {
      const orderRef = db.collection('shop_orders').doc();
      await orderRef.set({
        userId: uid,
        productId: pack.productId,
        amount: Number(amount),
        price: pack.price,
        status: 'pending_payment',
        createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true, pending: true, orderId: orderRef.id };
    }

    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const before = Number(data.crystals || 0);
      const after = before + Number(amount);
      t.update(ref, { crystals: after, updatedAt: FieldValue.serverTimestamp() });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, {
        userId: uid,
        amount: Number(amount),
        currency: 'crystals',
        type: 'DIAMOND_PACK_TEST_PURCHASE',
        referenceId: pack.productId,
        description: `Emulator purchase ${pack.productId}`,
        balanceBefore: before,
        balanceAfter: after,
        timestamp: FieldValue.serverTimestamp(),
      });
      return { success: true, pending: false, crystals: after };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function exchangeCrystalsForCreditsAction(idToken: string, crystalsAmount: number) {
  try {
    const { uid } = await requireServerActor(idToken);
    const amount = Number(crystalsAmount);
    if (![100, 500, 1000].includes(amount)) throw new Error('INVALID_EXCHANGE_AMOUNT');
    const creditsAmount = amount * 10000;
    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const crystals = Number(data.crystals || 0);
      const credits = Number(data.credits || 0);
      if (crystals < amount) throw new Error('INSUFFICIENT_FUNDS');
      t.update(ref, { crystals: crystals - amount, credits: credits + creditsAmount, updatedAt: FieldValue.serverTimestamp() });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, {
        userId: uid,
        amount: -amount,
        currency: 'crystals',
        type: 'CRYSTAL_TO_CREDITS',
        referenceId: `exchange_${amount}`,
        description: `Exchange ${amount} crystals for ${creditsAmount} credits`,
        balanceBefore: crystals,
        balanceAfter: crystals - amount,
        timestamp: FieldValue.serverTimestamp(),
      });
      return { success: true, crystals: crystals - amount, credits: credits + creditsAmount };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function changeClubNameAction(idToken: string, name: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 3 || clean.length > 25) throw new Error('INVALID_CLUB_NAME');
    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const crystals = Number(data.crystals || 0);
      if (crystals < 100) throw new Error('INSUFFICIENT_FUNDS');
      t.update(ref, { crystals: crystals - 100, clubName: clean, updatedAt: FieldValue.serverTimestamp() });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, { userId: uid, amount: -100, currency: 'crystals', type: 'CLUB_RENAME', referenceId: clean, description: `Rename club to ${clean}`, timestamp: FieldValue.serverTimestamp() });
      return { success: true, clubName: clean, crystals: crystals - 100 };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function changeClubCountryAction(idToken: string, country: unknown) {
  try {
    const { uid } = await requireServerActor(idToken);
    const parsed = CountrySchema.parse(country);
    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const crystals = Number(data.crystals || 0);
      if (crystals < 100) throw new Error('INSUFFICIENT_FUNDS');
      t.update(ref, { crystals: crystals - 100, country: parsed.name, countryCode: parsed.code, countryFlag: parsed.flag, updatedAt: FieldValue.serverTimestamp() });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, { userId: uid, amount: -100, currency: 'crystals', type: 'CLUB_COUNTRY_CHANGE', referenceId: parsed.code, description: `Change club country to ${parsed.name}`, timestamp: FieldValue.serverTimestamp() });
      return { success: true, country: parsed.name, crystals: crystals - 100 };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

export async function createShopPlayerAction(
  idToken: string,
  input: { nickname: string; role: Role; talent: number; age: number; country: { code: string; name: string; flag: string } }
) {
  try {
    const { uid } = await requireServerActor(idToken);
    const parsedRole = ROLE_SCHEMA.parse(input.role);
    if (!ROLES.includes(parsedRole)) throw new Error('INVALID_ROLE');
    const nickname = String(input.nickname || '').trim().replace(/\s+/g, ' ');
    const talent = Number(input.talent);
    const age = Number(input.age);
    if (nickname.length < 2 || nickname.length > 24) throw new Error('INVALID_PLAYER_NAME');
    if (![3.5, 4, 4.5, 5].includes(talent)) throw new Error('INVALID_TALENT');
    if (!Number.isInteger(age) || age < 14 || age > 28) throw new Error('INVALID_AGE');
    const country = CountrySchema.parse(input.country);

    let creationCost = 200;
    if (talent === 3.5) creationCost += 150;
    if (talent === 4) creationCost += 300;
    if (talent === 4.5) creationCost += 600;
    if (talent === 5) creationCost += 1200;
    if (age < 18) creationCost += 200;
    else if (age < 22) creationCost += 100;

    const db = getAdminDb();
    return await db.runTransaction(async (t) => {
      const ref = db.collection('players_v14').doc(uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const crystals = Number(data.crystals || 0);
      if (crystals < creationCost) throw new Error('INSUFFICIENT_FUNDS');
      const owned: Player[] = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
      const youth: Player[] = Array.isArray(data.youthAcademyPlayers) ? data.youthAcademyPlayers : [];
      if ([...owned, ...youth].some((p: any) => String(p?.name || '').toLowerCase() === nickname.toLowerCase())) throw new Error('PLAYER_NAME_ALREADY_EXISTS');

      const player = generateUniquePlayer(parsedRole, owned.length + youth.length, false, `shop_${uid}_${Date.now()}`);
      const overall = Math.round(30 + (talent - 3.5) * 20);
      const gameYearMs = 7 * 24 * 60 * 60 * 1000;
      const birthDate = new Date(Date.now() - age * gameYearMs).toISOString();
      const updated: Player = {
        ...player,
        id: `shop_${uid}_${Date.now()}`,
        name: nickname,
        overallRating: overall,
        price: overall * 2000 + 40000,
        salary: 1500 + overall * 100,
        baseAge: age,
        age,
        ageDisplay: `${age}.0`,
        birthDate,
        country,
        isYouth: age < 18,
        hiredAt: new Date().toISOString(),
        form: 95,
        fatigue: 100,
        proStats: Object.fromEntries(Object.keys(player.proStats).map(key => [key, Math.round(35 + (overall - 30) * 0.7)])) as Player['proStats'],
        proTalents: Object.fromEntries(Object.keys(player.proTalents).map(key => [key, talent])) as Player['proTalents'],
        trainingProgress: {},
        chemistryMatches: 0,
        lineupMatches: 0,
        isInjured: false,
      };

      t.update(ref, {
        crystals: crystals - creationCost,
        ownedPlayers: age >= 18 ? [...owned, updated] : owned,
        youthAcademyPlayers: age < 18 ? [...youth, updated] : youth,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const tx = db.collection('economy_transactions').doc();
      t.set(tx, { userId: uid, amount: -creationCost, currency: 'crystals', type: 'SHOP_PLAYER_CREATION', referenceId: updated.id, description: `Create player ${nickname}`, timestamp: FieldValue.serverTimestamp() });
      return { success: true, player: updated, creationCost, crystals: crystals - creationCost, isYouth: age < 18 };
    });
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}
