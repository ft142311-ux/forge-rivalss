"use server";

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { timestampToMillis } from '@/app/lib/timestamp-utils';
import { ageFromBirthDate, resolvePlayerBirthDate, PLAYER_AGE_SYSTEM_VERSION, PLAYER_GAME_MONTHS } from '@/app/lib/player-lifecycle-utils';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';

const FATIGUE_RECOVERY_PER_DAY = 10;

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
    await assertStagingSeasonOneResetNotInProgress(t, db);
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
      const birthDate = resolvePlayerBirthDate(player, currentAge, nowMs, needsMigration);
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
