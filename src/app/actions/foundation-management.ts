'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { getFoundationManagerRef } from './foundation-manager-ref';
import { applyTraining } from '@/game/foundation/training';
import { calculateTeamSynergy } from '@/game/foundation/synergy';
import { expectedAttendance, updateFansAfterHomeMatch } from '@/game/foundation/fans';
import { associationExperienceGain, validateSingleAssociation, qualifiesForAssociationCup } from '@/game/foundation/associations';
import { getTournamentRuleSet, canEnterTournament, buildOlympicPairs } from '@/game/foundation/tournaments';
import { FOUNDATION_COLLECTIONS } from '@/game/foundation/config';
import { deterministicDailyEvent } from '@/game/foundation/events';
import { isFoundationSkill } from '@/game/foundation/skills';

function errorOf(e: any) { return e?.message || 'FOUNDATION_ACTION_FAILED'; }

export async function setFoundationTrainingFocusAction(idToken: string, playerId: string, skill: string | null) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = getFoundationManagerRef(db, uid);
    if (skill !== null && !isFoundationSkill(skill)) throw new Error('INVALID_TRAINING_SKILL');
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const players = Array.isArray(data.ownedPlayers) ? [...data.ownedPlayers] : [];
      const idx = players.findIndex((p: any) => String(p.id) === String(playerId));
      if (idx < 0) throw new Error('UNIT_NOT_FOUND');
      const p = players[idx] || {};
      players[idx] = {
        ...p, trainingFocus: skill, dailyTrainingFocus: skill,
        trainingProgress: p.trainingProgress || {}, skillCaps: p.skillCaps || {}, skillInclinations: p.skillInclinations || {},
        trainingPropensity: Number.isFinite(Number(p.trainingPropensity)) ? Number(p.trainingPropensity) : 50,
        physical: Number.isFinite(Number(p.physical)) ? Number(p.physical) : 50,
        resilience: Number.isFinite(Number(p.resilience)) ? Number(p.resilience) : 50,
      };
      t.update(ref, { ownedPlayers: players, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function completePlayerTrainingAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    return await db.runTransaction(async t => {
      const ref = getFoundationManagerRef(db, uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const players: any[] = Array.isArray(data.ownedPlayers) ? [...data.ownedPlayers] : [];
      const index = players.findIndex(p => p.id === playerId);
      if (index < 0) throw new Error('UNIT_NOT_FOUND');
      const player = players[index];
      if (!player.dailyTrainingFinishTime || new Date(player.dailyTrainingFinishTime).getTime() > Date.now()) throw new Error('TRAINING_NOT_READY');
      const focus = player.dailyTrainingFocus || player.trainingFocus;
      if (!focus) throw new Error('TRAINING_FOCUS_MISSING');
      const staffBonus = data.staff?.coach ? 1.08 : 1;
      const result = applyTraining(player, focus, Math.round(90 * staffBonus));
      players[index] = { ...result.player, dailyTrainingFinishTime: null, lastTrainingCompletedAt: new Date().toISOString() };
      const synergy = calculateTeamSynergy(players.filter(p => Object.values(data.lineup || {}).includes(p.id)).slice(0, 5));
      t.update(ref, { ownedPlayers: players, teamSynergy: synergy, updatedAt: FieldValue.serverTimestamp() });
      return { success: true, result: result.result, teamSynergy: synergy };
    });
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function recalculateTeamSynergyAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = getFoundationManagerRef(db, uid);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const data = snap.data() || {};
    const lineup = data.lineup || {};
    const players = (Array.isArray(data.ownedPlayers) ? data.ownedPlayers : []).filter((p: any) => Object.values(lineup).includes(p.id)).slice(0, 5);
    const synergy = calculateTeamSynergy(players);
    await ref.update({ teamSynergy: synergy, updatedAt: FieldValue.serverTimestamp() });
    return { success: true, synergy };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function updateFansAfterOfficialHomeMatchAction(idToken: string, won: boolean, capacity = 10000) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = getFoundationManagerRef(db, uid);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const data = snap.data() || {};
    const attendance = expectedAttendance(data.fans, capacity);
    const fans = updateFansAfterHomeMatch(data.fans, attendance, won);
    await ref.update({ fans, updatedAt: FieldValue.serverTimestamp() });
    await db.collection(FOUNDATION_COLLECTIONS.fanSnapshots).add({ userId: uid, attendance, fans, createdAt: FieldValue.serverTimestamp() });
    return { success: true, fans, attendance };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function createFoundationTournamentAction(idToken: string, ruleId: string, name?: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const rule = getTournamentRuleSet(ruleId);
    const db = getAdminDb();
    const manager = await getFoundationManagerRef(db, uid).get();
    const managerData = manager.data() || {};
    let associationId = managerData.associationId || null;
    if (rule.id === 'association-cup' || rule.id === 'open-olympic') {
      if (!associationId) throw new Error('NO_ASSOCIATION');
      const assoc = await db.collection(FOUNDATION_COLLECTIONS.associations).doc(associationId).get();
      if (!assoc.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      if (rule.id === 'association-cup' && !qualifiesForAssociationCup(Array.isArray(assoc.data()?.memberIds) ? assoc.data()!.memberIds.length : 0)) throw new Error('ASSOCIATION_CUP_MIN_25');
      if (rule.id === 'open-olympic' && assoc.data()?.ownerId && assoc.data()?.ownerId !== uid) throw new Error('ASSOCIATION_LEADER_ONLY');
    }
    const ref = db.collection(FOUNDATION_COLLECTIONS.tournaments).doc();
    await ref.set({ id: ref.id, name: name || rule.name, ruleId: rule.id, rule, status: 'registration', participants: [uid], associationId, createdBy: uid, createdAt: FieldValue.serverTimestamp() });
    return { success: true, tournamentId: ref.id };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function registerFoundationTournamentAction(idToken: string, tournamentId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection(FOUNDATION_COLLECTIONS.tournaments).doc(tournamentId);
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('TOURNAMENT_NOT_FOUND');
      const data = snap.data() || {};
      if (data.status !== 'registration') throw new Error('TOURNAMENT_NOT_OPEN');
      const manager = await getFoundationManagerRef(db, uid).get();
      const managerData = manager.data() || {};
      if (data.associationId && managerData.associationId !== data.associationId) throw new Error('ASSOCIATION_MISMATCH');
      const participants: string[] = Array.isArray(data.participants) ? data.participants : [];
      if (participants.includes(uid)) return;
      if (!canEnterTournament(data.rule || getTournamentRuleSet(data.ruleId), participants.length + 1)) throw new Error('TOURNAMENT_FULL');
      t.update(ref, { participants: [...participants, uid], updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function recordFoundationTournamentResultAction(idToken: string, tournamentId: string, matchId: string, winnerId: string, loserId: string, winnerPoints = 1, loserPoints = 0) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const tournamentRef = db.collection(FOUNDATION_COLLECTIONS.tournaments).doc(tournamentId);
    const matchRef = db.collection(FOUNDATION_COLLECTIONS.tournamentMatches).doc(matchId);
    await db.runTransaction(async t => {
      const tournament = await t.get(tournamentRef);
      if (!tournament.exists) throw new Error('TOURNAMENT_NOT_FOUND');
      const data = tournament.data() || {};
      if (!Array.isArray(data.participants) || !data.participants.includes(uid)) throw new Error('NOT_PARTICIPANT');
      t.set(matchRef, { matchId, tournamentId, winnerId, loserId, winnerPoints, loserPoints, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
      t.update(tournamentRef, { lastMatchId: matchId, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function joinAssociationFoundationAction(idToken: string, associationId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = getFoundationManagerRef(db, uid);
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      if (!validateSingleAssociation(data.associationId, associationId)) throw new Error('ALREADY_IN_ASSOCIATION');
      const associationRef = db.collection(FOUNDATION_COLLECTIONS.associations).doc(associationId);
      const assoc = await t.get(associationRef);
      if (!assoc.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const a = assoc.data() || {};
      const members = Array.isArray(a.memberIds) ? a.memberIds : [];
      if (!members.includes(uid)) members.push(uid);
      t.update(ref, { associationId, updatedAt: FieldValue.serverTimestamp() });
      t.update(associationRef, { memberIds: members, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true, experienceGain: associationExperienceGain(false, false) };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

/** Server-authoritative role assignment. It never changes the player's base OVR. */
export async function changePlayerRoleAction(idToken: string, playerId: string, roleValue: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const allowed = ['Carry','Midlaner','Tank','Jungler','Support'];
    if (!allowed.includes(roleValue)) throw new Error('INVALID_ROLE');
    const ref = getFoundationManagerRef(db, uid);
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const players = Array.isArray(data.ownedPlayers) ? [...data.ownedPlayers] : [];
      const idx = players.findIndex((p:any) => String(p.id) === String(playerId));
      if (idx < 0) throw new Error('UNIT_NOT_OWNED');
      const lineup = { ...(data.lineup || {}) };
      const starterSlots = ['carry','mid','offlane','support','full_support'];
      const duplicate = starterSlots.some(slot => lineup[slot] === playerId && ({carry:'Carry',mid:'Midlaner',offlane:'Tank',support:'Jungler',full_support:'Support'} as any)[slot] === roleValue);
      if (!duplicate) {
        const occupied = starterSlots.some(slot => lineup[slot] && String(lineup[slot]) !== String(playerId) && players.find((p:any)=>String(p.id)===String(lineup[slot]))?.currentRole === roleValue);
        if (occupied) throw new Error('ROLE_ALREADY_ASSIGNED');
      }
      players[idx] = { ...players[idx], currentRole: roleValue };
      t.update(ref, { ownedPlayers: players, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true, role: roleValue };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function getFoundationDailyEventAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const period = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const ref = db.collection(FOUNDATION_COLLECTIONS.events).doc(`${uid}_${period}`);
    let snap = await ref.get();
    if (!snap.exists) {
      const managerRef = getFoundationManagerRef(db, uid);
      const managerSnap = await managerRef.get();
      if (managerSnap.exists) {
        const data = managerSnap.data() || {};
        const event = deterministicDailyEvent({ ...data, id: uid } as any, period);
        if (event) {
          await ref.create({ userId: uid, date: period, event, applied: false, resolvedAt: null, createdAt: FieldValue.serverTimestamp() });
          snap = await ref.get();
        }
      }
    }
    return { success: true, date: period, event: snap.exists ? snap.data() : null };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function getFoundationPlayerStatsAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const snap = await getFoundationManagerRef(db, uid).get();
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const players = Array.isArray(snap.data()?.ownedPlayers) ? snap.data()!.ownedPlayers : [];
    return { success: true, players: players.map((p:any) => ({
      id: String(p.id), name: p.name, role: p.currentRole || p.role, overallRating: Number(p.overallRating || 0),
      matches: Number(p.seasonStats?.matches ?? p.totalMatchesPlayed ?? 0), wins: Number(p.seasonStats?.wins ?? 0),
      successfulActions: Number(p.seasonStats?.successfulActions ?? p.successfulActions ?? 0),
      warnings: Number(p.seasonStats?.warnings ?? p.warningCount ?? 0), disqualifications: Number(p.seasonStats?.disqualifications ?? 0),
      kills: Number(p.seasonStats?.kills ?? 0), deaths: Number(p.seasonStats?.deaths ?? 0), assists: Number(p.seasonStats?.assists ?? 0),
      postMatchRating: Number(p.seasonStats?.postMatchRating ?? 0), chemistryMatches: Number(p.chemistryMatches ?? 0),
    })) };
  } catch (e) { return { success: false, error: errorOf(e) }; }
}

export async function getFoundationFansAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const snap = await getFoundationManagerRef(db, uid).get();
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    return { success: true, fans: snap.data()?.fans || { mood:50, communitySize:1000, attendanceLast3:[], attendance:0 } };
  } catch (e) { return { success:false, error:errorOf(e) }; }
}

export async function associationTreasuryPaymentAction(idToken: string, amount: number) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const managerRef = getFoundationManagerRef(db, uid);
    await db.runTransaction(async t => {
      const snap = await t.get(managerRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const associationId = data.associationId;
      if (!associationId) throw new Error('NO_ASSOCIATION');
      const payment = Math.max(0, Math.round(Number(amount || 0)));
      if (!payment) throw new Error('INVALID_AMOUNT');
      const balance = Math.max(0, Number(data.credits || 0));
      if (balance < payment) throw new Error('INSUFFICIENT_FUNDS');
      const assocRef = db.collection(FOUNDATION_COLLECTIONS.associations).doc(associationId);
      const assocSnap = await t.get(assocRef);
      if (!assocSnap.exists) throw new Error('ASSOCIATION_NOT_FOUND');
      const assoc = assocSnap.data() || {};
      t.update(managerRef, { credits: balance-payment, updatedAt: FieldValue.serverTimestamp() });
      t.update(assocRef, { treasury: Math.max(0, Number(assoc.treasury || 0))+payment, updatedAt: FieldValue.serverTimestamp() });
      t.set(db.collection(FOUNDATION_COLLECTIONS.economy).doc(), { userId:uid, associationId, amount:-payment, currency:'credits', type:'ASSOCIATION_PAYMENT', timestamp:FieldValue.serverTimestamp() });
    });
    return { success:true, amount:Math.round(Number(amount||0)) };
  } catch(e) { return { success:false, error:errorOf(e) }; }
}

export async function listFoundationAssociationTournamentsAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const manager = await getFoundationManagerRef(db, uid).get();
    const associationId = manager.data()?.associationId;
    if (!associationId) throw new Error('NO_ASSOCIATION');
    const snap = await db.collection(FOUNDATION_COLLECTIONS.tournaments).where('associationId','==',associationId).limit(50).get();
    return { success:true, tournaments:snap.docs.map(d=>({id:d.id,...d.data()})) };
  } catch(e){return {success:false,error:errorOf(e)};}
}

export async function startFoundationTournamentAction(idToken: string, tournamentId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection(FOUNDATION_COLLECTIONS.tournaments).doc(tournamentId);
    const result = await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('TOURNAMENT_NOT_FOUND');
      const data = snap.data() || {};
      if (data.createdBy !== uid) throw new Error('TOURNAMENT_OWNER_ONLY');
      if (data.status !== 'registration') throw new Error('TOURNAMENT_NOT_OPEN');
      const participants = Array.isArray(data.participants) ? [...data.participants] : [];
      const rule = data.rule || getTournamentRuleSet(data.ruleId);
      if (!canEnterTournament(rule, participants.length)) throw new Error('TOURNAMENT_MIN_PARTICIPANTS');
      const pairs = buildOlympicPairs(participants, 1);
      const matchRefs = pairs.map((pair:any) => db.collection(FOUNDATION_COLLECTIONS.tournamentMatches).doc());
      pairs.forEach((pair:any,i:number)=>t.set(matchRefs[i],{tournamentId,round:1,...pair,status:pair.bye?'bye':'scheduled',createdAt:FieldValue.serverTimestamp()}));
      t.update(ref,{status:'active',startedAt:FieldValue.serverTimestamp(),round:1,pairCount:pairs.length,updatedAt:FieldValue.serverTimestamp()});
      return {pairs:pairs.length};
    });
    return {success:true,...result};
  } catch(e){return {success:false,error:errorOf(e)};}
}
