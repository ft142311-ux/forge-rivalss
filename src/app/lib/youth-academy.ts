import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { generateScoutedPlayer, type Player } from './moba-data';
import { calculateLiveAge } from './time-utils';
import { applyTraining } from '@/game/foundation/training';
import { isFoundationSkill } from '@/game/foundation/skills';
import { readFoundationRoster } from '@/game/foundation/guards';
import { resolveTrainingFinishTimeMs } from './player-training-guards';
import { resolveMarketBidExpiryMs } from './market-bid-guards';
import { assertStagingSeasonOneResetNotInProgress } from './staging-season-one-write-fence';
import {
  getYouthAcademyCapacity,
  getYouthScoutLevel,
  resolveYouthPlayerAge,
  YOUTH_SCOUT_CANDIDATE_COUNT,
  YOUTH_TRAINING_DURATION_MS,
  YOUTH_TRAINING_MINUTES,
} from './youth-academy-rules';

function validateIdentity(uid: string, playerId?: string): void {
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) throw new Error('INVALID_MANAGER_ID');
  if (playerId !== undefined && (typeof playerId !== 'string' || !playerId.trim() || playerId.length > 128)) {
    throw new Error('INVALID_PLAYER_ID');
  }
}

function readRevision(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim().length === 0) throw new Error('YOUTH_SCOUTING_REVISION_INVALID');
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed >= Number.MAX_SAFE_INTEGER) {
    throw new Error('YOUTH_SCOUTING_REVISION_INVALID');
  }
  return parsed;
}

function isPlayerReserved(player: any, nowMs: number): boolean {
  if (player?.transferMarketId) return true;
  if (!player?.onTransferUntil) return false;
  const expiry = resolveMarketBidExpiryMs(player.onTransferUntil);
  return expiry === null || expiry > nowMs;
}

function readProfileRoster(profile: any, key: 'youthAcademyPlayers' | 'ownedPlayers'): any[] {
  const value = profile[key];
  return readFoundationRoster(value === undefined || value === null ? [] : value);
}

export async function scoutYouthCandidatesWithDb(
  db: any,
  uid: string,
  options: { nowMs?: number; scanId?: string } = {},
) {
  validateIdentity(uid);
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('INVALID_YOUTH_SCOUTING_TIME');
  const scanId = options.scanId || randomUUID();
  if (typeof scanId !== 'string' || !scanId.trim() || scanId.length > 128) throw new Error('INVALID_YOUTH_SCOUTING_ID');
  const profileRef = db.collection('players_v14').doc(uid);

  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const snap = await tx.get(profileRef);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const profile = snap.data() || {};
    const youth = readProfileRoster(profile, 'youthAcademyPlayers');
    const capacity = getYouthAcademyCapacity(profile.academy);
    if (youth.length >= capacity) throw new Error('YOUTH_ACADEMY_FULL');
    const revision = readRevision(profile.scoutingRevision);
    const scoutLevel = getYouthScoutLevel(profile.academy);
    const nextRevision = revision + 1;
    const candidates: Player[] = Array.from({ length: YOUTH_SCOUT_CANDIDATE_COUNT }, (_, index) => {
      const candidate = generateScoutedPlayer(index, scoutLevel, scanId + '_' + nextRevision + '_' + index, nowMs);
      const bonus = Math.min(20, scoutLevel * 1.25);
      candidate.proTalents = Object.fromEntries(
        Object.entries(candidate.proTalents).map(([key, value]) => [key, Math.min(100, Math.round(Number(value) + bonus))]),
      ) as Player['proTalents'];
      candidate.isYouth = true;
      candidate.dailyTrainingFocus = null;
      candidate.dailyTrainingFinishTime = null;
      candidate.onTransferUntil = null;
      candidate.transferMarketId = null;
      return candidate;
    });
    tx.update(profileRef, {
      scoutingCandidates: candidates,
      scoutingRevision: nextRevision,
      lastScoutDate: new Date(nowMs).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, count: candidates.length, scoutLevel, scoutingRevision: nextRevision };
  });
}

export async function recruitYouthCandidateWithDb(db: any, uid: string, playerId: string) {
  validateIdentity(uid, playerId);
  const profileRef = db.collection('players_v14').doc(uid);
  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const snap = await tx.get(profileRef);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const profile = snap.data() || {};
    const youth = readProfileRoster(profile, 'youthAcademyPlayers');
    const candidates = readFoundationRoster(profile.scoutingCandidates ?? []);
    const owned = readProfileRoster(profile, 'ownedPlayers');
    if (owned.some(player => player.id === playerId)) throw new Error('PLAYER_ALREADY_IN_FIRST_TEAM');
    const alreadyRecruited = youth.filter(player => player.id === playerId);
    if (alreadyRecruited.length === 1 && !candidates.some(player => player.id === playerId)) {
      return { success: true, alreadyRecruited: true, playerId };
    }
    if (alreadyRecruited.length > 0) throw new Error('YOUTH_PLAYER_DUPLICATE');
    const candidateMatches = candidates.filter(player => player.id === playerId);
    if (candidateMatches.length !== 1) throw new Error(candidateMatches.length > 1 ? 'YOUTH_CANDIDATE_DUPLICATE' : 'YOUTH_CANDIDATE_NOT_FOUND');
    const candidate: any = candidateMatches[0];
    if (candidate.isYouth !== true || isPlayerReserved(candidate, Date.now()) || candidate.dailyTrainingFinishTime) {
      throw new Error('SCOUTING_CANDIDATE_INVALID');
    }
    const capacity = getYouthAcademyCapacity(profile.academy);
    if (youth.length >= capacity) throw new Error('YOUTH_ACADEMY_FULL');
    const nextYouth = [...youth, candidate];
    const nextCandidates = candidates.filter(player => player.id !== playerId);
    tx.update(profileRef, {
      youthAcademyPlayers: nextYouth,
      scoutingCandidates: nextCandidates,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, alreadyRecruited: false, playerId, academyCount: nextYouth.length, capacity };
  });
}

export async function clearYouthScoutingReportWithDb(db: any, uid: string) {
  validateIdentity(uid);
  const profileRef = db.collection('players_v14').doc(uid);
  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const snap = await tx.get(profileRef);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    tx.update(profileRef, { scoutingCandidates: [], scoutingRevision: 0, updatedAt: FieldValue.serverTimestamp() });
    return { success: true };
  });
}

export async function promoteYouthPlayerWithDb(db: any, uid: string, playerId: string, nowMs = Date.now()) {
  validateIdentity(uid, playerId);
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('INVALID_YOUTH_PROMOTION_TIME');
  const profileRef = db.collection('players_v14').doc(uid);
  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const snap = await tx.get(profileRef);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const profile = snap.data() || {};
    const youth = readProfileRoster(profile, 'youthAcademyPlayers');
    const owned = readProfileRoster(profile, 'ownedPlayers');
    const youthMatches = youth.filter(player => player.id === playerId);
    const ownedMatches = owned.filter(player => player.id === playerId);
    if (youthMatches.length === 0 && ownedMatches.length === 1 && ownedMatches[0].isYouth === false) {
      return { success: true, alreadyPromoted: true, playerId };
    }
    if (youthMatches.length !== 1) throw new Error(youthMatches.length > 1 ? 'YOUTH_PLAYER_DUPLICATE' : 'YOUTH_PLAYER_NOT_FOUND');
    if (ownedMatches.length > 0) throw new Error('PLAYER_ALREADY_IN_SENIOR_SQUAD');
    const player: any = youthMatches[0];
    if (player.isYouth === false) throw new Error('YOUTH_PLAYER_INVALID');
    if (isPlayerReserved(player, nowMs)) throw new Error('YOUTH_PLAYER_ON_MARKET');
    if (player.dailyTrainingFinishTime) throw new Error('YOUTH_TRAINING_IN_PROGRESS');
    const age = resolveYouthPlayerAge(player, nowMs);
    if (age < 18) throw new Error('YOUTH_PLAYER_NOT_18');
    const ageInfo = calculateLiveAge(Number(player.baseAge), String(player.hiredAt || ''), player.birthDate, new Date(nowMs));
    const promoted = {
      ...player,
      isYouth: false,
      age,
      ageDisplay: ageInfo.display,
      dailyTrainingFocus: null,
      dailyTrainingFinishTime: null,
      onTransferUntil: null,
      transferMarketId: null,
      promotedAt: new Date(nowMs).toISOString(),
    };
    tx.update(profileRef, {
      youthAcademyPlayers: youth.filter(entry => entry.id !== playerId),
      ownedPlayers: [...owned, promoted],
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, alreadyPromoted: false, playerId, age: ageInfo.display };
  });
}

export async function startDailyTrainingWithDb(db: any, uid: string, playerId: string, focus: string, nowMs = Date.now()) {
  validateIdentity(uid, playerId);
  if (!isFoundationSkill(focus)) throw new Error('TRAINING_FOCUS_INVALID');
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('INVALID_TRAINING_TIME');
  const profileRef = db.collection('players_v14').doc(uid);
  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const snap = await tx.get(profileRef);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const profile = snap.data() || {};
    const youth = readProfileRoster(profile, 'youthAcademyPlayers');
    const senior = readProfileRoster(profile, 'ownedPlayers');
    const youthMatches = youth.filter(player => player.id === playerId);
    const seniorMatches = senior.filter(player => player.id === playerId);
    if (youthMatches.length + seniorMatches.length !== 1) {
      throw new Error(youthMatches.length + seniorMatches.length > 1 ? 'PLAYER_OWNERSHIP_AMBIGUOUS' : 'UNIT_NOT_FOUND');
    }
    const isYouth = youthMatches.length === 1;
    const roster = isYouth ? youth : senior;
    const index = roster.findIndex(player => player.id === playerId);
    const player: any = roster[index];
    if (isYouth && player.isYouth === false) throw new Error('YOUTH_PLAYER_INVALID');
    if (isPlayerReserved(player, nowMs)) throw new Error(isYouth ? 'YOUTH_PLAYER_ON_MARKET' : 'PLAYER_ON_MARKET');
    if (player.dailyTrainingFinishTime) throw new Error('TRAINING_ALREADY_IN_PROGRESS');
    const finishTime = new Date(nowMs + YOUTH_TRAINING_DURATION_MS).toISOString();
    roster[index] = { ...player, dailyTrainingFocus: focus, dailyTrainingFinishTime: finishTime };
    tx.update(profileRef, {
      [isYouth ? 'youthAcademyPlayers' : 'ownedPlayers']: roster,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, finishTime };
  });
}

export async function completeDailyYouthTrainingWithDb(db: any, uid: string, playerId: string, nowMs = Date.now()) {
  validateIdentity(uid, playerId);
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('INVALID_TRAINING_TIME');
  const profileRef = db.collection('players_v14').doc(uid);
  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const snap = await tx.get(profileRef);
    if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
    const profile = snap.data() || {};
    const youth = readProfileRoster(profile, 'youthAcademyPlayers');
    const owned = readProfileRoster(profile, 'ownedPlayers');
    if (owned.some(player => player.id === playerId)) throw new Error('PLAYER_OWNERSHIP_AMBIGUOUS');
    const matches = youth.filter(player => player.id === playerId);
    if (matches.length !== 1) throw new Error(matches.length > 1 ? 'YOUTH_PLAYER_DUPLICATE' : 'YOUTH_PLAYER_NOT_FOUND');
    const index = youth.findIndex(player => player.id === playerId);
    const player: any = youth[index];
    if (player.isYouth === false) throw new Error('YOUTH_PLAYER_INVALID');
    if (isPlayerReserved(player, nowMs)) throw new Error('YOUTH_PLAYER_ON_MARKET');
    const finishAtMs = resolveTrainingFinishTimeMs(player.dailyTrainingFinishTime);
    if (finishAtMs === null) throw new Error('YOUTH_TRAINING_NOT_IN_PROGRESS');
    if (finishAtMs > nowMs) throw new Error('YOUTH_TRAINING_NOT_FINISHED');
    const focus = player.dailyTrainingFocus;
    if (!isFoundationSkill(focus)) throw new Error('YOUTH_TRAINING_FOCUS_INVALID');
    const age = resolveYouthPlayerAge(player, nowMs);
    const trained = applyTraining({ ...player, age }, focus, YOUTH_TRAINING_MINUTES);
    const gained = Math.max(0, trained.result.newValue - trained.result.oldValue);
    youth[index] = {
      ...trained.player,
      age,
      dailyTrainingFocus: null,
      dailyTrainingFinishTime: null,
      lastYouthTrainingAt: new Date(nowMs).toISOString(),
    };
    tx.update(profileRef, { youthAcademyPlayers: youth, updatedAt: FieldValue.serverTimestamp() });
    return { success: true, focus, gained, statValue: trained.result.newValue };
  });
}
