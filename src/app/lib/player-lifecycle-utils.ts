import { timestampToMillis } from './timestamp-utils';

export const PLAYER_AGE_SYSTEM_VERSION = 5;
export const PLAYER_GAME_MONTHS = 12;

const PLAYER_GAME_YEAR_DAYS = 7;
const PLAYER_GAME_YEAR_MS = PLAYER_GAME_YEAR_DAYS * 24 * 60 * 60 * 1000;
const PLAYER_GAME_MONTH_MS = PLAYER_GAME_YEAR_MS / PLAYER_GAME_MONTHS;

export function agePartsFromMs(ageMs: number) {
  const safeMs = Math.max(0, ageMs);
  const years = Math.floor(safeMs / PLAYER_GAME_YEAR_MS);
  const remainder = safeMs - years * PLAYER_GAME_YEAR_MS;
  const month = Math.min(12, Math.max(0, Math.floor(remainder / PLAYER_GAME_MONTH_MS + 1e-9)));
  return { years, month, display: `${years}.${month}`, numeric: years + month / PLAYER_GAME_MONTHS };
}

export function ageFromBirthDate(birthDate: unknown, nowMs: number) {
  const birthDateMs = timestampToMillis(birthDate);
  if (!Number.isFinite(birthDateMs) || birthDateMs <= 0 || birthDateMs > nowMs) {
    throw new Error('INVALID_PLAYER_BIRTH_DATE');
  }
  return agePartsFromMs(nowMs - birthDateMs);
}

export function birthDateFromLegacyAge(age: number, nowMs: number) {
  const parsedAge = Number(age);
  const safeAge = Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge : 18;
  const years = Math.floor(safeAge);
  const month = Math.min(12, Math.max(0, Math.round((safeAge - years) * PLAYER_GAME_MONTHS)));
  const ageMs = (years + month / PLAYER_GAME_MONTHS) * PLAYER_GAME_YEAR_MS;
  return new Date(nowMs - ageMs).toISOString();
}

/** Keep a valid current-version birth date; migrate malformed/future values from the persisted legacy age. */
export function resolvePlayerBirthDate(
  player: Record<string, any>,
  currentAge: number,
  nowMs: number,
  needsMigration: boolean,
) {
  if (!needsMigration) {
    const existingBirthDate = player?.birthDate;
    const birthDateMs = timestampToMillis(existingBirthDate);
    if (Number.isFinite(birthDateMs) && birthDateMs > 0 && birthDateMs <= nowMs) {
      return existingBirthDate;
    }
  }
  return birthDateFromLegacyAge(currentAge, nowMs);
}
