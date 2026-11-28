'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor, requireAdminActor } from '@/lib/server-auth';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';
import { getFoundationManagerRef } from './foundation-manager-ref';
import { FOUNDATION_COLLECTIONS } from '@/game/foundation/config';
import { readFoundationRoster } from '@/game/foundation/guards';
import { expectedAttendance } from '@/game/foundation/fans';
import { chooseGoldenPlayer, scoreGoldenPlayer } from '@/game/foundation/awards';
import { setFoundationTrainingFocusAction as setFoundationTrainingFocusActionCanonical } from './foundation-management';

function fail(e: any) { return { success: false, error: e?.message || 'FOUNDATION_ACTION_FAILED' }; }

function moscowDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function normalizeSeasonId(value: unknown) {
  const seasonId = String(value ?? '').trim();
  if (!/^(?:current|S?[1-9]\d*)$/.test(seasonId)) throw new Error('INVALID_SEASON_ID');
  return seasonId;
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
    if (choice !== 'accept' && choice !== 'decline') throw new Error('INVALID_EVENT_CHOICE');
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId || normalizedEventId.length > 128) throw new Error('INVALID_EVENT_ID');
    const db = getAdminDb();
    const period = moscowDayKey();
    const ref = db.collection(FOUNDATION_COLLECTIONS.events).doc(`${uid}_${period}`);
    const managerRef = getFoundationManagerRef(db, uid);
    const result = await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [freshEvent, freshManager] = await Promise.all([t.get(ref), t.get(managerRef)]);
      if (!freshEvent.exists) throw new Error('EVENT_NOT_FOUND');
      const eventData = freshEvent.data() || {};
      if (eventData.resolvedAt) return { alreadyResolved: true };
      if (String(eventData.event?.id || '') !== normalizedEventId) throw new Error('EVENT_MISMATCH');
      if (!freshManager.exists) throw new Error('PLAYER_NOT_FOUND');
      const effects = choice === 'accept' ? (eventData.event?.effects || {}) : {};
      const managerData = freshManager.data() || {};
      const players = readFoundationRoster(managerData.ownedPlayers);
      const next = players.map((p: any) => ({
        ...p,
        form: Math.max(0, Math.min(100, Number(p.form ?? 100) + Number(effects.form || 0))),
        fatigue: Math.max(0, Math.min(100, Number(p.fatigue ?? 100) + Number(effects.fatigue || 0))),
        tilt: Math.max(0, Math.min(100, Number(p.tilt ?? 0) + Number(effects.tilt || 0))),
      }));
      t.update(managerRef, { ownedPlayers: next, updatedAt: FieldValue.serverTimestamp() });
      t.update(ref, { resolved: choice, resolvedAt: FieldValue.serverTimestamp(), applied: choice === 'accept' });
      return { alreadyResolved: false };
    });
    return { success: true, choice, ...result };
  } catch (e) { return fail(e); }
}
export async function foundationFanAction(idToken: string, action: 'free_entry' | 'away_trip' | 'autograph' | 'fan_groups') {
  try {
    const { uid } = await requireServerActor(idToken);
    const allowedActions = ['free_entry', 'away_trip', 'autograph', 'fan_groups'];
    if (!allowedActions.includes(String(action))) throw new Error('INVALID_FAN_ACTION');
    const db = getAdminDb();
    const ref = getFoundationManagerRef(db, uid);
    const today = moscowDayKey();
    const actionRef = db.collection(FOUNDATION_COLLECTIONS.fanSnapshots).doc(`${uid}_${today}_${action}`);
    const result = await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [freshAction, managerSnap] = await Promise.all([t.get(actionRef), t.get(ref)]);
      if (freshAction.exists) throw new Error('FAN_ACTION_ALREADY_USED');
      if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = managerSnap.data() || {};
      const fans = { mood: 50, communitySize: 1000, attendanceLast3: [], attendance: 0, ...(data.fans || {}) } as any;
      if (action === 'autograph') fans.mood = Math.min(100, Number(fans.mood) + 5);
      if (action === 'fan_groups') {
        fans.communitySize = Math.max(0, Number(fans.communitySize) + 1000);
        fans.mood = Math.min(100, Number(fans.mood) + 2);
      }
      if (action === 'free_entry') fans.mood = Math.min(100, Number(fans.mood) + 3);
      if (action === 'away_trip') fans.mood = Math.min(100, Number(fans.mood) + 2);
      const capacity = Number(data.arenaCapacity || 10000);
      const attendance = action === 'free_entry' ? capacity : expectedAttendance(fans, capacity);
      t.update(ref, { fans: { ...fans, attendance }, updatedAt: FieldValue.serverTimestamp() });
      t.create(actionRef, {
        userId: uid,
        action,
        date: today,
        attendance,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { fans, attendance };
    });
    return { success: true, ...result };
  } catch (e) { return fail(e); }
}
export async function castGoldenPlayerVoteAction(idToken: string, seasonId: string, playerId: string, playerName: string, managerName: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const normalizedSeasonId = normalizeSeasonId(seasonId);
    const normalizedPlayerId = String(playerId || '').trim();
    if (!normalizedPlayerId || normalizedPlayerId.length > 128) throw new Error('INVALID_PLAYER_ID');
    const normalizedPlayerName = String(playerName || 'Player').trim().slice(0, 80) || 'Player';
    const db = getAdminDb();
    const managerRef = getFoundationManagerRef(db, uid);
    const voteRef = db.collection(FOUNDATION_COLLECTIONS.awards).doc(`${normalizedSeasonId}_golden_player_votes_${uid}`);
    const weight = await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [managerSnap, voteSnap] = await Promise.all([t.get(managerRef), t.get(voteRef)]);
      if (!managerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      if (voteSnap.exists) throw new Error('ALREADY_VOTED');
      const manager = managerSnap.data() || {};
      const level = Number(manager.level || manager.managerLevel || 0);
      const hasLicense = Boolean(manager.licenses?.coaching || manager.coachingLicense || manager.licenses?.tier);
      if (level < 10 && !hasLicense) throw new Error('AWARD_VOTE_LOCKED');
      const isVip = Boolean(manager.isPremium || manager.vip || manager.premium);
      const voterName = String(manager.displayName || manager.managerName || manager.clubName || managerName || 'Manager').trim().slice(0, 80) || 'Manager';
      const voteWeight = isVip ? 2 : 1;
      t.create(voteRef, {
        seasonId: normalizedSeasonId,
        voterId: uid,
        voterName,
        playerId: normalizedPlayerId,
        playerName: normalizedPlayerName,
        weight: voteWeight,
        createdAt: FieldValue.serverTimestamp(),
      });
      return voteWeight;
    });
    return { success: true, weight };
  } catch (e) { return fail(e); }
}
export async function resolveGoldenPlayerAwardAction(idToken: string, seasonId: string) {
  try {
    const { uid } = await requireAdminActor(idToken);
    const normalizedSeasonId = normalizeSeasonId(seasonId);
    const db = getAdminDb();
    const managers = await db.collection(FOUNDATION_COLLECTIONS.managers).get();
    const candidates = managers.docs.flatMap(managerDoc => {
      const managerData = managerDoc.data() || {};
      const players = readFoundationRoster(managerData.ownedPlayers);
      return players.map((player: any) => {
        const stats = player.seasonStats || player.stats || {
          matches: player.totalMatchesPlayed || 0,
          successfulActions: player.successfulActions || 0,
        };
        return {
          playerId: String(player.id || ''),
          playerName: String(player.name || 'Player').trim().slice(0, 80) || 'Player',
          score: scoreGoldenPlayer(stats),
          reason: 'Сезонная эффективность',
        };
      }).filter((candidate: any) => candidate.playerId && Number.isFinite(candidate.score) && candidate.score > 0);
    });
    const winner = chooseGoldenPlayer(candidates);
    if (!winner) throw new Error('NO_AWARD_CANDIDATES');
    const ref = db.collection(FOUNDATION_COLLECTIONS.awards).doc(`${normalizedSeasonId}_golden_player`);
    const result = await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const existing = await t.get(ref);
      if (existing.exists) return { winner: existing.data()?.winner || winner, alreadyResolved: true };
      t.create(ref, {
        seasonId: normalizedSeasonId,
        type: 'golden_player',
        winner,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: uid,
      });
      return { winner, alreadyResolved: false };
    });
    return { success: true, ...result };
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
    const normalizedSeasonId = normalizeSeasonId(seasonId);
    const normalizedManagerId = String(managerId || '').trim();
    if (!normalizedManagerId || normalizedManagerId.length > 128) throw new Error('INVALID_MANAGER_ID');
    const db = getAdminDb();
    const voterRef = getFoundationManagerRef(db, uid);
    const voteRef = db.collection(FOUNDATION_COLLECTIONS.awards).doc(`${normalizedSeasonId}_golden_jacket_votes_${uid}`);
    const weight = await db.runTransaction(async t => {
      await assertStagingSeasonOneResetNotInProgress(t, db);
      const [voterSnap, voteSnap] = await Promise.all([t.get(voterRef), t.get(voteRef)]);
      if (!voterSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      if (voteSnap.exists) throw new Error('ALREADY_VOTED');
      const voter = voterSnap.data() || {};
      const level = Number(voter.level || voter.managerLevel || 0);
      const licensed = Boolean(voter.licenses?.coaching || voter.coachingLicense || voter.licenses?.tier);
      if (level < 10 && !licensed) throw new Error('AWARD_VOTE_LOCKED');
      const voteWeight = (voter.isPremium || voter.vip || voter.premium) ? 2 : 1;
      const voterName = String(voter.displayName || voter.managerName || voter.clubName || managerName || 'Manager').trim().slice(0, 80) || 'Manager';
      t.create(voteRef, {
        seasonId: normalizedSeasonId,
        voterId: uid,
        managerId: normalizedManagerId,
        managerName: String(managerName || 'Manager').trim().slice(0, 80) || 'Manager',
        voterName,
        weight: voteWeight,
        type: 'golden_jacket',
        createdAt: FieldValue.serverTimestamp(),
      });
      return voteWeight;
    });
    return { success: true, weight };
  } catch (e) { return { success: false, error: fail(e).error }; }
}