'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { calculatePlayerMarketValue, Player, StaffMember, StaffRole, generateScoutedPlayer, generateStaffMember } from '@/app/lib/moba-data';
import { isFoundationSkill } from '@/game/foundation/skills';

const COMMISSION_RATE = 0.05;

function err(e: any) { return e instanceof Error ? e.message : String(e || 'P2_ACTION_FAILED'); }
function money(n: any) { return Math.max(0, Math.floor(Number(n) || 0)); }
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

/** Rebuilds market values from authoritative player skills. */
export async function syncPlayerMarketValuesAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection('players_v14').doc(uid);
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const p = snap.data() || {};
      const players = Array.isArray(p.ownedPlayers) ? p.ownedPlayers : [];
      const youth = Array.isArray(p.youthAcademyPlayers) ? p.youthAcademyPlayers : [];
      const update = (x: any) => ({ ...x, marketValue: calculatePlayerMarketValue(x), price: calculatePlayerMarketValue(x) });
      t.update(ref, { ownedPlayers: players.map(update), youthAcademyPlayers: youth.map(update), updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Buys an active transfer-market lot atomically. */
export async function buyMarketPlayerAction(idToken: string, marketId: string) {
  try {
    const { uid: buyerId } = await requireServerActor(idToken);
    const db = getAdminDb();
    if (!marketId) throw new Error('INVALID_MARKET_LOT');
    return await db.runTransaction(async t => {
      const marketRef = db.collection('market_v7').doc(marketId);
      const lotSnap = await t.get(marketRef);
      if (!lotSnap.exists) throw new Error('LOT_NOT_FOUND');
      const lot = lotSnap.data() || {};
      const sellerId = String(lot.sellerId || '');
      if (!sellerId || sellerId === buyerId) throw new Error('INVALID_BUYER');
      if (lot.expiresAt && new Date(String(lot.expiresAt)).getTime() <= Date.now()) throw new Error('LOT_EXPIRED');
      const price = money(lot.currentBid || lot.startingPrice || lot.price);
      if (price <= 0) throw new Error('INVALID_PRICE');

      const buyerRef = db.collection('players_v14').doc(buyerId);
      const sellerRef = db.collection('players_v14').doc(sellerId);
      const [buyerSnap, sellerSnap] = await Promise.all([t.get(buyerRef), t.get(sellerRef)]);
      if (!buyerSnap.exists || !sellerSnap.exists) throw new Error('MANAGER_NOT_FOUND');
      const buyer = buyerSnap.data() || {};
      const seller = sellerSnap.data() || {};
      const balance = money(buyer.credits);
      if (balance < price) throw new Error('INSUFFICIENT_FUNDS');

      const player = clone(lot.heroData || {});
      if (!player.id) throw new Error('PLAYER_DATA_MISSING');
      const sellerPlayers: Player[] = Array.isArray(seller.ownedPlayers) ? seller.ownedPlayers : [];
      const sellerIndex = sellerPlayers.findIndex(p => p.id === player.id);
      if (sellerIndex < 0) throw new Error('PLAYER_NO_LONGER_OWNED');
      const buyerPlayers: Player[] = Array.isArray(buyer.ownedPlayers) ? buyer.ownedPlayers : [];
      if (buyerPlayers.some(p => p.id === player.id)) throw new Error('PLAYER_ALREADY_OWNED');

      const soldPlayer = { ...player, onTransferUntil: null, transferMarketId: null, marketValue: calculatePlayerMarketValue(player), price: calculatePlayerMarketValue(player), hiredAt: player.hiredAt || new Date().toISOString() };
      sellerPlayers.splice(sellerIndex, 1);
      buyerPlayers.push(soldPlayer);
      const commission = Math.floor(price * COMMISSION_RATE);
      const sellerIncome = price - commission;

      t.update(buyerRef, { credits: balance - price, ownedPlayers: buyerPlayers, updatedAt: FieldValue.serverTimestamp() });
      t.update(sellerRef, { credits: money(seller.credits) + sellerIncome, ownedPlayers: sellerPlayers, updatedAt: FieldValue.serverTimestamp() });
      t.delete(marketRef);

      const transferRef = db.collection('transfer_history').doc();
      t.set(transferRef, { playerId: player.id, playerName: player.name, buyerId, sellerId, price, commission, sellerIncome, marketId, createdAt: FieldValue.serverTimestamp() });
      return { success: true, player: soldPlayer, price, commission, sellerIncome };
    });
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Completes a daily training session and awards XP/form/fatigue changes. */
export async function completeDailyTrainingAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection('players_v14').doc(uid);
    await db.runTransaction(async t => {
      const snap = await t.get(ref); if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const p = snap.data() || {}; const players: any[] = Array.isArray(p.ownedPlayers) ? p.ownedPlayers : [];
      const i = players.findIndex(x => x.id === playerId); if (i < 0) throw new Error('UNIT_NOT_FOUND');
      const player = players[i];
      if (!player.dailyTrainingFinishTime || new Date(String(player.dailyTrainingFinishTime)).getTime() > Date.now()) throw new Error('TRAINING_NOT_FINISHED');
      const focus = String(player.dailyTrainingFocus || 'lastHitting');
      if (!isFoundationSkill(focus)) throw new Error('INVALID_TRAINING_FOCUS');
      const stats = { ...(player.proStats || {}) };
      const talents = { ...(player.proTalents || {}) };
      const old = Math.max(0, Number(stats[focus] || 0));
      const cap = Math.max(old, Number(talents[focus] || old));
      const gain = old < cap ? 1 : (Math.random() < 0.25 ? 1 : 0);
      stats[focus] = Math.min(100, old + gain);
      const xpStats = { ...(player.xpStats || {}), [focus]: Number((player.xpStats || {})[focus] || 0) + 100 };
      const overall = Math.round(Object.values(stats).reduce((a: number, v: any) => a + Number(v || 0), 0) / Math.max(1, Object.keys(stats).length));
      const next = { ...player, proStats: stats, xpStats, overallRating: Math.max(Number(player.overallRating || 0), overall), form: Math.min(100, Number(player.form || 0) + 2), fatigue: Math.max(0, Number(player.fatigue || 0) - 8), dailyTrainingFocus: null, dailyTrainingStartedAt: null, dailyTrainingFinishTime: null };
      next.marketValue = calculatePlayerMarketValue(next); next.price = next.marketValue;
      players[i] = next;
      t.update(ref, { ownedPlayers: players, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Promotes a youth player to the first team without any contract layer. */
export async function promoteYouthPlayerAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken); const db = getAdminDb(); const ref = db.collection('players_v14').doc(uid);
    await db.runTransaction(async t => {
      const snap = await t.get(ref); if (!snap.exists) throw new Error('PLAYER_NOT_FOUND'); const p = snap.data() || {};
      const youth: any[] = Array.isArray(p.youthAcademyPlayers) ? p.youthAcademyPlayers : []; const i = youth.findIndex(x => x.id === playerId); if (i < 0) throw new Error('YOUTH_NOT_FOUND');
      const y = youth[i]; if (Number(y.age || 0) < 18) throw new Error('YOUTH_TOO_YOUNG');
      youth.splice(i, 1); const promoted = { ...y, isYouth: false, marketValue: calculatePlayerMarketValue(y), price: calculatePlayerMarketValue(y) };
      const owned = Array.isArray(p.ownedPlayers) ? p.ownedPlayers : []; owned.push(promoted); t.update(ref, { youthAcademyPlayers: youth, ownedPlayers: owned, updatedAt: FieldValue.serverTimestamp() });
    }); return { success: true };
  } catch (e) { return { success: false, error: err(e) }; }
}

export async function releaseYouthPlayerAction(idToken: string, playerId: string) {
  try { const { uid } = await requireServerActor(idToken); const db = getAdminDb(); const ref = db.collection('players_v14').doc(uid); await db.runTransaction(async t => { const s=await t.get(ref); if(!s.exists) throw new Error('PLAYER_NOT_FOUND'); const p=s.data()||{}; const y=Array.isArray(p.youthAcademyPlayers)?p.youthAcademyPlayers:[]; if(!y.some((x:any)=>x.id===playerId)) throw new Error('YOUTH_NOT_FOUND'); t.update(ref,{youthAcademyPlayers:y.filter((x:any)=>x.id!==playerId),updatedAt:FieldValue.serverTimestamp()}); }); return {success:true}; } catch(e){return {success:false,error:err(e)}}
}

export async function scoutYouthPlayerAction(idToken: string) {
  try { const { uid }=await requireServerActor(idToken); const db=getAdminDb(); const ref=db.collection('players_v14').doc(uid); return await db.runTransaction(async t=>{ const s=await t.get(ref); if(!s.exists) throw new Error('PLAYER_NOT_FOUND'); const p=s.data()||{}; const cost=25000; if(money(p.credits)<cost) throw new Error('INSUFFICIENT_FUNDS'); const candidates=Array.isArray(p.scoutingCandidates)?p.scoutingCandidates:[]; const candidate=generateScoutedPlayer(candidates.length,Number(p.staff?.scout?.skills?.primary||10)); candidate.marketValue=calculatePlayerMarketValue(candidate); candidate.price=candidate.marketValue; t.update(ref,{credits:money(p.credits)-cost,scoutingCandidates:[...candidates,candidate],updatedAt:FieldValue.serverTimestamp()}); const tx=db.collection('economy_transactions').doc(); t.set(tx,{userId:uid,amount:-cost,currency:'credits',type:'YOUTH_SCOUTING',referenceId:candidate.id,description:'Youth scouting',timestamp:FieldValue.serverTimestamp()}); return {success:true,candidate}; }); } catch(e){return {success:false,error:err(e)}}
}

export async function hireStaffAction(idToken: string, role: StaffRole) {
  try { const {uid}=await requireServerActor(idToken); const db=getAdminDb(); const ref=db.collection('players_v14').doc(uid); const allowed=['coach','analyst','scout','doctor','financier']; if(!allowed.includes(role)) throw new Error('INVALID_STAFF_ROLE'); await db.runTransaction(async t=>{const s=await t.get(ref);if(!s.exists)throw new Error('PLAYER_NOT_FOUND');const p=s.data()||{};if(p.staff?.[role])throw new Error('STAFF_ROLE_OCCUPIED');const member=generateStaffMember(role);const cost=50000; if(money(p.credits)<cost)throw new Error('INSUFFICIENT_FUNDS');const staff={...(p.staff||{}),[role]:member};t.update(ref,{credits:money(p.credits)-cost,staff,updatedAt:FieldValue.serverTimestamp()});const tx=db.collection('economy_transactions').doc();t.set(tx,{userId:uid,amount:-cost,currency:'credits',type:'STAFF_HIRE',referenceId:member.id,description:`Hire ${role}`,timestamp:FieldValue.serverTimestamp()});});return{success:true}; } catch(e){return{success:false,error:err(e)}}
}

export async function fireStaffAction(idToken: string, role: StaffRole) {
  try { const {uid}=await requireServerActor(idToken); const db=getAdminDb(); await db.runTransaction(async t=>{const ref=db.collection('players_v14').doc(uid);const s=await t.get(ref);if(!s.exists)throw new Error('PLAYER_NOT_FOUND');const p=s.data()||{};if(!p.staff?.[role])throw new Error('STAFF_NOT_FOUND');t.update(ref,{staff:{...(p.staff||{}),[role]:null},updatedAt:FieldValue.serverTimestamp()});});return{success:true}; } catch(e){return{success:false,error:err(e)}}
}



const PLAYER_ACTION_COSTS = {
  fatigueCredits: 5000,
  fatigueCrystals: 5,
  formCredits: 10000,
  injuryCredits: 25000,
  injuryCrystals: 25,
} as const;

async function mutateOwnedPlayer(
  idToken: string,
  playerId: string,
  mutation: (player: any, manager: any) => { player?: any; manager?: any; result?: any }
) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const ref = db.collection('players_v14').doc(uid);
  return db.runTransaction(async t => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const manager = snap.data() || {};
    const players: any[] = Array.isArray(manager.ownedPlayers) ? [...manager.ownedPlayers] : [];
    const index = players.findIndex(x => x.id === playerId);
    if (index < 0) throw new Error('UNIT_NOT_OWNED');
    const result = mutation(players[index], manager);
    if (result.player) players[index] = result.player;
    t.update(ref, { ...(result.manager || {}), ownedPlayers: players, updatedAt: FieldValue.serverTimestamp() });
    return result.result || { success: true };
  });
}

/** Restore one player's fatigue for credits. */
export async function recoverPlayerFatigueCreditsAction(idToken: string, playerId: string) {
  try {
    return await mutateOwnedPlayer(idToken, playerId, (player, manager) => {
      const balance = money(manager.credits);
      if (balance < PLAYER_ACTION_COSTS.fatigueCredits) throw new Error('INSUFFICIENT_FUNDS');
      const next = { ...player, fatigue: 100 };
      next.marketValue = calculatePlayerMarketValue(next); next.price = next.marketValue;
      return { player: next, manager: { credits: balance - PLAYER_ACTION_COSTS.fatigueCredits }, result: { success: true, fatigue: 100 } };
    });
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Restore one player's fatigue for crystals. */
export async function recoverPlayerFatigueCrystalsAction(idToken: string, playerId: string) {
  try {
    return await mutateOwnedPlayer(idToken, playerId, (player, manager) => {
      const balance = money(manager.crystals);
      if (balance < PLAYER_ACTION_COSTS.fatigueCrystals) throw new Error('INSUFFICIENT_CRYSTALS');
      const next = { ...player, fatigue: 100 };
      next.marketValue = calculatePlayerMarketValue(next); next.price = next.marketValue;
      return { player: next, manager: { crystals: balance - PLAYER_ACTION_COSTS.fatigueCrystals }, result: { success: true, fatigue: 100 } };
    });
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Raise one player's form by 15 points, capped at 100. */
export async function boostPlayerFormAction(idToken: string, playerId: string) {
  try {
    return await mutateOwnedPlayer(idToken, playerId, (player, manager) => {
      const balance = money(manager.credits);
      if (balance < PLAYER_ACTION_COSTS.formCredits) throw new Error('INSUFFICIENT_FUNDS');
      const next = { ...player, form: Math.min(100, Number(player.form || 0) + 15) };
      next.marketValue = calculatePlayerMarketValue(next); next.price = next.marketValue;
      return { player: next, manager: { credits: balance - PLAYER_ACTION_COSTS.formCredits }, result: { success: true, form: next.form } };
    });
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Instantly heals an injured player. */
export async function healPlayerAction(idToken: string, playerId: string) {
  try {
    return await mutateOwnedPlayer(idToken, playerId, (player, manager) => {
      if (!player.isInjured && !player.injuredUntil) throw new Error('PLAYER_NOT_INJURED');
      const balance = money(manager.credits);
      if (balance < PLAYER_ACTION_COSTS.injuryCredits) throw new Error('INSUFFICIENT_FUNDS');
      const next = { ...player, isInjured: false, injuredUntil: null };
      next.marketValue = calculatePlayerMarketValue(next); next.price = next.marketValue;
      return { player: next, manager: { credits: balance - PLAYER_ACTION_COSTS.injuryCredits }, result: { success: true, healed: true } };
    });
  } catch (e) { return { success: false, error: err(e) }; }
}

/** Permanently releases one owned player. No contract or release payment exists. */
export async function releaseOwnedPlayerAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection('players_v14').doc(uid);
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const manager = snap.data() || {};
      const players: any[] = Array.isArray(manager.ownedPlayers) ? manager.ownedPlayers : [];
      const player = players.find(x => x.id === playerId);
      if (!player) throw new Error('UNIT_NOT_OWNED');
      if (player.onTransferUntil) throw new Error('PLAYER_ON_MARKET');
      t.update(ref, { ownedPlayers: players.filter(x => x.id !== playerId), updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: err(e) }; }
}

export async function getP2ManagementSummaryAction(idToken: string) {
  try { const {uid}=await requireServerActor(idToken); const s=await getAdminDb().collection('players_v14').doc(uid).get(); if(!s.exists)throw new Error('PLAYER_NOT_FOUND'); const p=s.data()||{}; const players=Array.isArray(p.ownedPlayers)?p.ownedPlayers:[]; const youth=Array.isArray(p.youthAcademyPlayers)?p.youthAcademyPlayers:[]; const staff=Object.values(p.staff||{}).filter(Boolean) as any[]; return {success:true,playerCount:players.length,youthCount:youth.length,staffCount:staff.length,playerSalaries:players.reduce((a:any,x:any)=>a+money(x.salary),0),staffSalaries:staff.reduce((a:any,x:any)=>a+money(x.salary),0),rosterMarketValue:players.reduce((a:any,x:any)=>a+calculatePlayerMarketValue(x),0)}; } catch(e){return{success:false,error:err(e)}}
}
