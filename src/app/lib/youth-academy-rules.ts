import { calculateLiveAge } from './time-utils';

export const YOUTH_ACADEMY_BASE_CAPACITY = 10;
export const YOUTH_SCOUT_CANDIDATE_COUNT = 5;
export const YOUTH_TRAINING_DURATION_MS = 24 * 60 * 60 * 1000;
export const YOUTH_TRAINING_MINUTES = 90;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNonNegativeLevel(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim().length === 0) throw new Error('YOUTH_ACADEMY_STATE_INVALID');
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1000) throw new Error('YOUTH_ACADEMY_STATE_INVALID');
  return parsed;
}

function readAcademy(academy: unknown): Record<string, any> {
  if (academy === undefined || academy === null) return {};
  if (!isRecord(academy)) throw new Error('YOUTH_ACADEMY_STATE_INVALID');
  return academy;
}

export function getYouthAcademyCapacity(academy: unknown): number {
  const capacity = YOUTH_ACADEMY_BASE_CAPACITY + readNonNegativeLevel(readAcademy(academy).youthBootcampLevel);
  if (!Number.isSafeInteger(capacity)) throw new Error('YOUTH_ACADEMY_STATE_INVALID');
  return capacity;
}

export function getYouthScoutLevel(academy: unknown): number {
  return Math.min(20, readNonNegativeLevel(readAcademy(academy).scoutsLevel));
}

export function readYouthAcademyRoster(value: unknown, errorCode = 'YOUTH_ROSTER_INVALID'): any[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(errorCode);
  const ids = new Set<string>();
  for (const player of value) {
    if (!isRecord(player) || typeof player.id !== 'string') throw new Error(errorCode);
    const id = player.id.trim();
    if (!id || id !== player.id || id.length > 128 || ids.has(id)) throw new Error(errorCode);
    ids.add(id);
  }
  return [...value];
}

export function resolveYouthPlayerAge(player: unknown, nowMs: number): number {
  if (!isRecord(player) || !Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('YOUTH_PLAYER_AGE_INVALID');
  const birthDate = typeof player.birthDate === 'string' ? player.birthDate : null;
  const birthMs = birthDate ? Date.parse(birthDate) : Number.NaN;
  const hiredAt = typeof player.hiredAt === 'string' ? player.hiredAt : '';
  const hiredAtMs = Date.parse(hiredAt);
  const baseAge = Number(player.baseAge);
  if (birthDate && !Number.isFinite(birthMs)) throw new Error('YOUTH_PLAYER_AGE_INVALID');
  if (!Number.isFinite(birthMs) && (!Number.isFinite(baseAge) || baseAge <= 0 || !Number.isFinite(hiredAtMs))) {
    throw new Error('YOUTH_PLAYER_AGE_INVALID');
  }
  const age = calculateLiveAge(baseAge, hiredAt, birthDate, new Date(nowMs)).numeric;
  if (!Number.isFinite(age) || age < 0 || age > 100) throw new Error('YOUTH_PLAYER_AGE_INVALID');
  return age;
}

export function isYouthMarketLockOwnedByLot(player: unknown, lotId: string): boolean {
  return isRecord(player) && typeof lotId === 'string' && lotId.length > 0 &&
    typeof player.transferMarketId === 'string' && player.transferMarketId === lotId;
}

export function isYouthMarketLockValidForLot(
  player: unknown,
  lotId: string,
  lotExpiryMs: number | null,
  lockExpiryMs: number | null,
): boolean {
  return isYouthMarketLockOwnedByLot(player, lotId) &&
    lotExpiryMs !== null && Number.isFinite(lotExpiryMs) &&
    lockExpiryMs !== null && Number.isFinite(lockExpiryMs) &&
    lockExpiryMs >= lotExpiryMs;
}

export function canAcceptYouthAuctionPurchase(roster: unknown, academy: unknown, playerId: string): boolean {
  const players = readYouthAcademyRoster(roster, 'AUCTION_BUYER_ROSTER_INVALID');
  if (typeof playerId !== 'string' || !playerId.trim()) return false;
  if (players.some(player => player.id === playerId)) return false;
  return players.length < getYouthAcademyCapacity(academy);
}
