'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { getFoundationManagerRef } from './foundation-manager-ref';
import { FOUNDATION_COLLECTIONS } from '@/game/foundation/config';
import { expectedAttendance } from '@/game/foundation/fans';
import { chooseGoldenPlayer, scoreGoldenPlayer } from '@/game/foundation/awards';
import { setFoundationTrainingFocusAction as setFoundationTrainingFocusActionCanonical } from './foundation-management';

function fail(e: any) { return { success: false, error: e?.message || 'FOUNDATION_ACTION_FAILED' }; }

function moscowDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}


/**
 * Backward-compatible action export.
 *
 * Keep this entry point for callers using foundation-advanced, but delegate to
 * the canonical transactional implementation so validation and writes cannot
 * drift between the two action modules.
 */
export async function setFoundationTrainingFocusAction(idToken: string, playerId: string, skill: string | null) {
  return setFoundationTrainingFocusActionCanonical(idToken, playerId, skill);
}

export async function resolveFoundationEventAction(idToken: string, eventId: string, choice: 'accept' | 'decline' = 'accept') {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const period = moscowDayKey();
    const ref = db.collection(FOUNDATION_COLLECTIONS.events).doc(`${uid}_${period}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('EVENT_NOT_FOUND');
    const event = snap.data() || {};
    if (event.resolvedAt) return { success: true, alreadyResolved: true };
    if (String(event.event?.id || eventId) !== String(eventId)) throw new Error('EVENT_MISMATCH');
    const managerRef = getFoundationManagerRef(db, uid);
    if (!(await managerRef.get()).exists) throw new Error('PLAYER_NOT_FOUND');
    const effects = choice === 'accept' ? (event.event?.effects || {}) : {};
    await db.runTransaction(async t => {
      const freshEvent = await t.get(ref);
      const freshManager = await t.get(managerRef);
      if (!freshEvent.exists || freshEvent.data()?.resolvedAt) return;
      if (!freshManager.exists) throw new Error('PLAYER_NOT_FOUND');
      const players = Array.isArray(freshManager.data()?.ownedPlayers) ? freshManager.data()!.ownedPlayers : [];
      const next = players.map((p: any) => ({
        ...p,
        form: Math.max(0, Math.min(100, Number(p.form ?? 100) + Number(effects.form || 0))),
        fatigue: Math.max(0, Math.min(100, Number(p.fatigue ?? 100) + Number(effects.fatigue || 0))),
        tilt: Math.max(0, Math.min(100, Number(p.tilt ?? 0) + Number(effects.tilt || 0))),
      }));
      t.update(managerRef, { ownedPlayers: next, updatedAt: FieldValue.serverTimestamp() });
      t.update(ref, { resolved: choice, resolvedAt: FieldValue.serverTimestamp(), applied: choice === 'accept' });
    });
    return { success: true, choice };
  } catch (e) { return fail(e); }
}

export async function foundationFanAction(idToken: string, action: 'free_entry' | 'away_trip' | 'autograph' | 'fan_groups') {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = getFoundationManagerRef(db, uid);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const data = snap.data() || {};
    const fans = { mood: 50, communitySize: 1000, attendanceLast3: [], attendance: 0, ...(data.fans || {}) } as any;
    const today = moscowDayKey();
    const actionRef = db.collection(FOUNDATION_COLLECTIONS.fanSnapshots).doc(`${uid}_${today}_${action}`);
    const old = await actionRef.get();
    if (old.exists) throw new Error('FAN_ACTION_ALREADY_USED');
    if (action === 'autograph') fans.mood = Math.min(100, Number(fans.mood) + 5);
    if (action === 'fan_groups') { fans.communitySize = Math.max(0, Number(fans.communitySize) + 1000); fans.mood = Math.min(100, Number(fans.mood) + 2); }
    if (action === 'free_entry') fans.mood = Math.min(100, Number(fans.mood) + 3);
    if (action === 'away_trip') fans.mood = Math.min(100, Number(fans.mood) + 2);
    const capacity = Number(data.arenaCapacity || 10000);
    const attendance = action === 'free_entry' ? capacity : expectedAttendance(fans, capacity);
    await db.runTransaction(async t => {
      const fresh = await t.get(actionRef);
      if (fresh.exists) throw new Error('FAN_ACTION_ALREADY_USED');
      t.update(ref, { fans: { ...fans, attendance }, updatedAt: FieldValue.serverTimestamp() });
      t.set(actionRef, { userId: uid, action, date: today, attendance, createdAt: FieldValue.serverTimestamp() });
    });
    return { success: true, fans, attendance };
  } catch (e) { return fail(e); }
}

export async function castGoldenPlayerVoteAction(idToken: string, seasonId: string, playerId: string, playerName: string, managerName: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const managerRef = getFoundationManagerRef(db, uid);
    const managerSnap = await managerRef.get();
    if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    const manager = managerSnap.data() || {};
    const level = Number(manager.level || manager.managerLevel || 0);
    const hasLicense = Boolean(manager.licenses?.coaching || manager.coachingLicense || manager.licenses?.tier);
    if (level < 10 && !hasLicense) throw new Error('AWARD_VOTE_LOCKED');
    const isVip = Boolean(manager.isPremium || manager.vip || manager.premium);
    const voteRef = db.collection(FOUNDATION_COLLECTIONS.awards).doc(`${seasonId}_golden_player_votes_${uid}`);
    const vote = await voteRef.get();
    if (vote.exists) throw new Error('ALREADY_VOTED');
    await voteRef.set({ seasonId, voterId: uid, voterName: managerName, playerId, playerName, weight: isVip ? 2 : 1, createdAt: FieldValue.serverTimestamp() });
    return { success: true, weight: isVip ? 2 : 1 };
  } catch (e) { return fail(e); }
}

export async function resolveGoldenPlayerAwardAction(idToken: string, seasonId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const manager = await getFoundationManagerRef(db, uid).get();
    if (!manager.exists) throw new Error('PLAYER_NOT_FOUND');
    const data = manager.data() || {};
    const players = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
    const candidates = players.map((p: any) => ({
      playerId: String(p.id),
      playerName: String(p.name || 'Player'),
      score: scoreGoldenPlayer(p.seasonStats || p.stats || { matches: p.totalMatchesPlayed || 0, successfulActions: p.successfulActions || 0 }),
      reason: 'Сезонная эффективность',
    }));
    const winner = chooseGoldenPlayer(candidates);
    if (!winner) throw new Error('NO_AWARD_CANDIDATES');
    const ref = db.collection(FOUNDATION_COLLECTIONS.awards).doc(`${seasonId}_golden_player`);
    await ref.set({ seasonId, type: 'golden_player', winner, resolvedAt: FieldValue.serverTimestamp(), resolvedBy: uid }, { merge: true });
    return { success: true, winner };
  } catch (e) { return fail(e); }
}

export async function calculateFoundationPostMatchRatings(idToken: string, matchId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const snap = await db.collection(FOUNDATION_COLLECTIONS.matches).doc(matchId).get();
    if (!snap.exists) throw new Error('MATCH_NOT_FOUND');
    const m = snap.data() || {};
    const isHome = m.homeId === uid;
    const isAway = m.awayId === uid;
    if (!isHome && !isAway) throw new Error('MATCH_ACCESS_DENIED');
    const sim = m.simulation || {};
    const homeStrength = Number(m.sportingStrength?.home || m.homeOverall || 0);
    const awayStrength = Number(m.sportingStrength?.away || m.awayOverall || 0);
    const opponent = isHome ? awayStrength : homeStrength;
    const own = isHome ? homeStrength : awayStrength;
    const manager = await getFoundationManagerRef(db, uid).get();
    const data = manager.data() || {};
    const tier = Number(data.licenses?.coaching?.tier || data.coachingLicense?.tier || 0);
    const vip = Boolean(data.isPremium || data.vip);
    const error = vip ? 0 : Math.max(0, 0.20 - tier * 0.04);
    const direction = ((String(sim?.engineVersion || '').length + String(matchId).length) % 2 === 0) ? 1 : -1;
    const opponentVisible = Math.round(opponent * (1 + direction * error));
    const games = Array.isArray(sim.games) ? sim.games : [];
    const lastGame = games[games.length - 1] || {};
    const comparison = lastGame.teamComparison || null;
    const sideIndex = isHome ? 0 : 1;
    const opponentIndex = isHome ? 1 : 0;
    return { success: true, own: Math.round(own), opponent: opponentVisible, opponentExact: vip, maxError: error, unavailable: Boolean(m.isBotMatch || m.isBot || m.homeIsBot || m.awayIsBot), comparison: comparison ? { farm: comparison.farm?.[sideIndex] ?? null, mapControl: comparison.control?.[sideIndex] ?? null, teamwork: comparison.teamwork?.[sideIndex] ?? null, objectives: comparison.objectives?.[sideIndex] ?? null, opponentFarm: comparison.farm?.[opponentIndex] ?? null, opponentMapControl: comparison.control?.[opponentIndex] ?? null } : null };
  } catch (e) { return fail(e); }
}

export async function castGoldenJacketVoteAction(idToken: string, seasonId: string, managerId: string, managerName: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const voter = await getFoundationManagerRef(db, uid).get();
    if (!voter.exists) throw new Error('PLAYER_NOT_FOUND');
    const vd = voter.data() || {};
    const level = Number(vd.level || vd.managerLevel || 0);
    const licensed = Boolean(vd.licenses?.coaching || vd.coachingLicense || vd.licenses?.tier);
    if (level < 10 && !licensed) throw new Error('AWARD_VOTE_LOCKED');
    const weight = (vd.isPremium || vd.vip || vd.premium) ? 2 : 1;
    const ref = db.collection(FOUNDATION_COLLECTIONS.awards).doc(`${seasonId}_golden_jacket_votes_${uid}`);
    if ((await ref.get()).exists) throw new Error('ALREADY_VOTED');
    await ref.set({seasonId,voterId:uid,managerId,managerName,weight,type:'golden_jacket',createdAt:FieldValue.serverTimestamp()});
    return {success:true,weight};
  } catch(e){return {success:false,error:fail(e).error};}
}
