"use server";

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { timestampToMillis } from '@/app/lib/timestamp-utils';

const PLAYER_GAME_YEAR_DAYS = 7;
const PLAYER_GAME_MONTHS = 12;
const PLAYER_GAME_YEAR_MS = PLAYER_GAME_YEAR_DAYS * 24 * 60 * 60 * 1000;
const PLAYER_GAME_MONTH_MS = PLAYER_GAME_YEAR_MS / PLAYER_GAME_MONTHS;
const PLAYER_AGE_SYSTEM_VERSION = 5;
const FATIGUE_RECOVERY_PER_DAY = 10;

function agePartsFromMs(ageMs: number) {
  const safeMs = Math.max(0, ageMs);
  const years = Math.floor(safeMs / PLAYER_GAME_YEAR_MS);
  const remainder = safeMs - years * PLAYER_GAME_YEAR_MS;
  const month = Math.min(12, Math.max(0, Math.floor(remainder / PLAYER_GAME_MONTH_MS + 1e-9)));
  return { years, month, display: `${years}.${month}`, numeric: years + month / PLAYER_GAME_MONTHS };
}

function ageFromBirthDate(birthDate: string, nowMs: number) {
  return agePartsFromMs(nowMs - (timestampToMillis(birthDate) || 0));
}

function birthDateFromLegacyAge(age: number, nowMs: number) {
  const safeAge = Math.max(0, Number(age) || 18);
  const years = Math.floor(safeAge);
  const month = Math.min(12, Math.max(0, Math.round((safeAge - years) * PLAYER_GAME_MONTHS)));
  const ageMs = (years + month / PLAYER_GAME_MONTHS) * PLAYER_GAME_YEAR_MS;
  return new Date(nowMs - ageMs).toISOString();
}

export const JUNIOR_MIN_AGE = 14;
export const JUNIOR_PROMOTION_AGE = 18;
export const JUNIOR_MAX_AGE = 19;
export const ADULT_MIN_AGE = 18;
export const ADULT_MAX_AGE = 35 + 12 / PLAYER_GAME_MONTHS;

export function canPromoteJunior(age: { years: number; month: number }) {
  return age.years > JUNIOR_PROMOTION_AGE || (age.years === JUNIOR_PROMOTION_AGE && age.month >= 0);
}

export async function syncPlayerLifecycleAction(idToken: string) {
  const { uid } = await requireServerActor(idToken);
  const db = getAdminDb();
  const ref = db.collection('players_v14').doc(uid);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return { success: false, error: 'PLAYER_NOT_FOUND' };
    const data = snap.data() || {};
    const players: any[] = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
    let changed = false;
    let recovered = false;

    const updatedPlayers = players.map((player) => {
      const rawAge = Number(player.age);
      const legacyAge = Number(player.baseAge);
      const currentAge = (Number.isFinite(rawAge) && rawAge > 0) ? rawAge : ((Number.isFinite(legacyAge) && legacyAge > 0) ? legacyAge : (player.isYouth ? 15 : 18));
      const needsMigration = Number(player.ageSystemVersion ?? 0) !== PLAYER_AGE_SYSTEM_VERSION;
      const birthDate = needsMigration
        ? birthDateFromLegacyAge(currentAge, nowMs)
        : (player.birthDate || birthDateFromLegacyAge(currentAge, nowMs));
      const age = ageFromBirthDate(birthDate, nowMs);
      const lastFatigueAt = timestampToMillis(player.lastFatigueAt || player.hiredAt || nowIso) || nowMs;
      const elapsedDays = Math.max(0, (nowMs - lastFatigueAt) / (24 * 60 * 60 * 1000));
      const recovery = Math.floor(elapsedDays * FATIGUE_RECOVERY_PER_DAY);
      const rawFatigue = Number(player.fatigue);
      const currentFatigue = (Number.isFinite(rawFatigue) && rawFatigue >= 0) ? Math.max(0, Math.min(100, rawFatigue)) : 100;
      const nextFatigue = Math.min(100, currentFatigue + recovery);
      if (needsMigration || !player.birthDate || player.ageDisplay !== age.display || Math.abs(Number(player.age ?? -1) - age.numeric) >= 0.001 || nextFatigue !== currentFatigue) changed = true;
      if (nextFatigue !== currentFatigue) recovered = true;
      return {
        ...player,
        birthDate,
        age: age.numeric,
        ageDisplay: age.display,
        ageSystemVersion: PLAYER_AGE_SYSTEM_VERSION,
        fatigue: nextFatigue,
        lastFatigueAt: recovery > 0 ? nowIso : (player.lastFatigueAt || nowIso)
      };
    });

    if (changed) {
      t.update(ref, { ownedPlayers: updatedPlayers, updatedAt: FieldValue.serverTimestamp() });
    }
    return { success: true, changed, recovered, players: updatedPlayers };
  });
}
