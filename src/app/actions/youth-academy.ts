'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';
import { generateScoutedPlayer, type Player } from '@/app/lib/moba-data';
import { calculateLiveAge } from '@/app/lib/time-utils';

const YOUTH_TRAINING_FOCUSES = new Set([
  'lastHitting', 'mapAwareness', 'positioning', 'reflexes', 'manaManagement',
  'objectiveControl', 'communication', 'tiltResistance', 'versatility', 'ganking',
]);

function youthCapacity(profile: any) {
  const academy = profile?.academy && typeof profile.academy === 'object' ? profile.academy : {};
  return 10 + Math.max(0, Math.floor(Number(academy.youthBootcampLevel) || 0));
}

function roster(value: unknown, error: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(error);
  return value;
}

function validPlayerId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 128) throw new Error('INVALID_PLAYER_ID');
  return id;
}

export async function scoutYouthCandidatesAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const result = await db.runTransaction(async (tx: any) => {
      await assertStagingSeasonOneResetNotInProgress(tx, db);
      const snap = await tx.get(profileRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const profile = snap.data() || {};
      const academy = profile.academy && typeof profile.academy === 'object' ? profile.academy : {};
      const scoutLevel = Math.max(0, Math.min(20, Math.floor(Number(academy.scoutsLevel) || 0)));
      const candidates: Player[] = Array.from({ length: 5 }, (_, index) => {
        const candidate = generateScoutedPlayer(index, scoutLevel, 'youth_' + uid.slice(0, 8) + '_' + seed + '_' + index);
        const bonus = Math.min(20, scoutLevel * 1.25);
        candidate.proTalents = Object.fromEntries(
          Object.entries(candidate.proTalents).map(([key, value]) => [key, Math.min(100, Math.round(Number(value) + bonus))]),
        ) as Player['proTalents'];
        candidate.isYouth = true;
        candidate.dailyTrainingFocus = null;
        candidate.dailyTrainingFinishTime = null;
        return candidate;
      });
      tx.update(profileRef, {
        scoutingCandidates: candidates,
        lastScoutDate: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { count: candidates.length, scoutLevel };
    });
    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error?.message || 'YOUTH_SCOUTING_FAILED' };
  }
}

export async function recruitYouthCandidateAction(idToken: string, candidateId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const safeId = validPlayerId(candidateId);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    return await db.runTransaction(async (tx: any) => {
      await assertStagingSeasonOneResetNotInProgress(tx, db);
      const snap = await tx.get(profileRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const profile = snap.data() || {};
      const candidates = roster(profile.scoutingCandidates, 'SCOUTING_REPORT_INVALID');
      const youthPlayers = roster(profile.youthAcademyPlayers, 'YOUTH_ROSTER_INVALID');
      if (youthPlayers.length >= youthCapacity(profile)) throw new Error('YOUTH_ACADEMY_FULL');
      const matches = candidates.filter((player: any) => String(player?.id || '') === safeId);
      if (matches.length !== 1) throw new Error(matches.length ? 'YOUTH_CANDIDATE_DUPLICATE' : 'YOUTH_CANDIDATE_NOT_FOUND');
      if (youthPlayers.some((player: any) => String(player?.id || '') === safeId)) throw new Error('YOUTH_PLAYER_ALREADY_RECRUITED');
      const player = {
        ...matches[0], isYouth: true, dailyTrainingFocus: null, dailyTrainingFinishTime: null,
        onTransferUntil: null, transferMarketId: null,
      };
      tx.update(profileRef, {
        youthAcademyPlayers: [...youthPlayers, player],
        scoutingCandidates: candidates.filter((candidate: any) => String(candidate?.id || '') !== safeId),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { success: true, playerId: safeId, academyCount: youthPlayers.length + 1, capacity: youthCapacity(profile) };
    });
  } catch (error: any) {
    return { success: false, error: error?.message || 'YOUTH_RECRUITMENT_FAILED' };
  }
}

export async function clearYouthScoutingReportAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    await db.runTransaction(async (tx: any) => {
      await assertStagingSeasonOneResetNotInProgress(tx, db);
      const snap = await tx.get(profileRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      tx.update(profileRef, { scoutingCandidates: [], updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'YOUTH_SCOUTING_CLEAR_FAILED' };
  }
}

export async function promoteYouthPlayerAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const safeId = validPlayerId(playerId);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    return await db.runTransaction(async (tx: any) => {
      await assertStagingSeasonOneResetNotInProgress(tx, db);
      const snap = await tx.get(profileRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const profile = snap.data() || {};
      const youthPlayers = roster(profile.youthAcademyPlayers, 'YOUTH_ROSTER_INVALID');
      const seniorPlayers = roster(profile.ownedPlayers, 'SENIOR_ROSTER_INVALID');
      const matches = youthPlayers.filter((player: any) => String(player?.id || '') === safeId);
      if (matches.length !== 1) throw new Error(matches.length ? 'YOUTH_PLAYER_DUPLICATE' : 'YOUTH_PLAYER_NOT_FOUND');
      const player = matches[0];
      const age = calculateLiveAge(Number(player.baseAge) || 14, String(player.hiredAt || new Date().toISOString()), player.birthDate);
      if (age.numeric < 18) throw new Error('YOUTH_PLAYER_NOT_18');
      if ((player.onTransferUntil && new Date(player.onTransferUntil).getTime() > Date.now()) || player.transferMarketId) {
        throw new Error('YOUTH_PLAYER_ON_MARKET');
      }
      if (seniorPlayers.some((entry: any) => String(entry?.id || '') === safeId)) throw new Error('PLAYER_ALREADY_IN_SENIOR_SQUAD');
      const promoted = {
        ...player, isYouth: false, age: age.numeric, ageDisplay: age.display,
        dailyTrainingFocus: null, dailyTrainingFinishTime: null,
        onTransferUntil: null, transferMarketId: null, promotedAt: new Date().toISOString(),
      };
      tx.update(profileRef, {
        youthAcademyPlayers: youthPlayers.filter((entry: any) => String(entry?.id || '') !== safeId),
        ownedPlayers: [...seniorPlayers, promoted],
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { success: true, playerId: safeId, age: age.display };
    });
  } catch (error: any) {
    return { success: false, error: error?.message || 'YOUTH_PROMOTION_FAILED' };
  }
}

export async function completeDailyYouthTrainingAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const safeId = validPlayerId(playerId);
    const db = getAdminDb();
    const profileRef = db.collection('players_v14').doc(uid);
    return await db.runTransaction(async (tx: any) => {
      await assertStagingSeasonOneResetNotInProgress(tx, db);
      const snap = await tx.get(profileRef);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const profile = snap.data() || {};
      const youthPlayers = roster(profile.youthAcademyPlayers, 'YOUTH_ROSTER_INVALID');
      const matches = youthPlayers.filter((player: any) => String(player?.id || '') === safeId);
      if (matches.length !== 1) throw new Error(matches.length ? 'YOUTH_PLAYER_DUPLICATE' : 'YOUTH_PLAYER_NOT_FOUND');
      const index = youthPlayers.findIndex((player: any) => String(player?.id || '') === safeId);
      const player: any = youthPlayers[index];
      const finishAt = new Date(String(player.dailyTrainingFinishTime || '')).getTime();
      if (!Number.isFinite(finishAt)) throw new Error('YOUTH_TRAINING_NOT_IN_PROGRESS');
      if (Date.now() < finishAt) throw new Error('YOUTH_TRAINING_NOT_FINISHED');
      const focus = String(player.dailyTrainingFocus || '');
      if (!YOUTH_TRAINING_FOCUSES.has(focus)) throw new Error('YOUTH_TRAINING_FOCUS_INVALID');
      const stats = { ...(player.proStats || {}) } as Record<string, number>;
      const talents = { ...(player.proTalents || {}) } as Record<string, number>;
      const progress = { ...(player.trainingProgress || {}) } as Record<string, number>;
      const caps = { ...(player.skillCaps || {}) } as Record<string, number>;
      const current = Math.max(0, Number(stats[focus]) || 0);
      const talent = Math.max(0, Number(talents[focus]) || 40);
      const cap = Math.max(current, Number(caps[focus]) || Math.min(100, 45 + talent * 0.55));
      caps[focus] = cap;
      const age = calculateLiveAge(Number(player.baseAge) || 14, String(player.hiredAt || new Date().toISOString()), player.birthDate).numeric;
      const ageFactor = age < 16 ? 1.15 : age < 18 ? 1.05 : 0.95;
      const accumulated = Math.max(0, Number(progress[focus]) || 0) + ageFactor * (0.75 + talent / 100);
      const points = current >= cap ? 0 : Math.min(cap - current, Math.floor(accumulated));
      stats[focus] = current + points;
      progress[focus] = points > 0 ? accumulated - Math.floor(accumulated) : Math.min(accumulated, 0.999);
      youthPlayers[index] = {
        ...player, proStats: stats, trainingProgress: progress, skillCaps: caps,
        dailyTrainingFocus: null, dailyTrainingFinishTime: null, lastYouthTrainingAt: new Date().toISOString(),
      };
      tx.update(profileRef, { youthAcademyPlayers: youthPlayers, updatedAt: FieldValue.serverTimestamp() });
      return { success: true, focus, gained: points, statValue: stats[focus] };
    });
  } catch (error: any) {
    return { success: false, error: error?.message || 'YOUTH_TRAINING_COMPLETE_FAILED' };
  }
}
