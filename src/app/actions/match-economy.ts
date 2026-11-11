import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export type MatchEconomy = {
  attendance: number;
  ticketRevenue: number;
  cafeRevenue: number;
  shopRevenue: number;
  parkingRevenue: number;
  tvRevenue: number;
  totalRevenue: number;
  attendanceRate: number;
  infrastructureMultiplier: number;
};

function n(value: unknown, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Server-authoritative match economy.
 * Infrastructure efficiency is 0.05% per level (level * 0.0005).
 * The bonus is intentionally small at low levels and scales continuously.
 */
export async function calculateMatchEconomy(home: any, match: any, scoreA: number, scoreB: number): Promise<MatchEconomy> {
  const capacity = Math.max(0, Math.floor(n(home?.arena?.capacity, 5000)));
  const arena = home?.arena || {};

  const press = Math.max(0, n(arena.pressCenterLevel));
  const cafe = Math.max(0, n(arena.cafeLevel));
  const shop = Math.max(0, n(arena.shopLevel));
  const screens = Math.max(0, n(arena.screensLevel));
  const parking = Math.max(0, n(arena.parkingLevel));
  const lighting = Math.max(0, n(arena.lightingLevel));

  const infrastructureMultiplier = 1 + (
    press + cafe + shop + screens + parking + lighting
  ) * 0.0005;

  const rankHome = n(match?.homeRank, 8);
  const rankAway = n(match?.awayRank, 8);
  const rankInterest = Math.max(0.90, Math.min(1.15, 1 + (16 - rankHome - rankAway) * 0.01));
  const resultInterest = scoreA === scoreB ? 1.00 : 1.02;
  const screenAttendanceBonus = 1 + screens * 0.0005;
  const parkingAttendanceBonus = 1 + parking * 0.0005;
  const lightingWeatherBonus = lighting > 0 ? 1 : 0.98;

  const rawAttendance = capacity * 0.60 * rankInterest * resultInterest * screenAttendanceBonus * parkingAttendanceBonus * lightingWeatherBonus;
  const attendance = Math.max(0, Math.min(capacity, Math.floor(rawAttendance)));

  const ticketRevenue = Math.round(attendance * 15 * infrastructureMultiplier);
  const cafeRevenue = Math.round(attendance * (5 + cafe * 0.05) * infrastructureMultiplier);
  const shopRevenue = Math.round(attendance * (8 + shop * 0.08) * infrastructureMultiplier);
  const parkingRevenue = Math.round(attendance * (3 + parking * 0.03) * infrastructureMultiplier);
  const tvRevenue = Math.round(30000 * (1 + press * 0.0005) * (1 + screens * 0.0005));
  const totalRevenue = ticketRevenue + cafeRevenue + shopRevenue + parkingRevenue + tvRevenue;

  return {
    attendance,
    ticketRevenue,
    cafeRevenue,
    shopRevenue,
    parkingRevenue,
    tvRevenue,
    totalRevenue,
    attendanceRate: capacity > 0 ? attendance / capacity : 0,
    infrastructureMultiplier,
  };
}

/** Persist the already calculated match economy for a club. */
export async function recordMatchEconomy(
  uid: string,
  matchId: string,
  economy: MatchEconomy,
) {
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(uid);
  const txRef = db.collection('economy_transactions').doc(`match_${matchId}_${uid}`);

  await db.runTransaction(async (t) => {
    const [playerSnap, txSnap] = await Promise.all([t.get(playerRef), t.get(txRef)]);
    if (!playerSnap.exists) throw new Error('PLAYER_NOT_FOUND');
    if (txSnap.exists) return;

    const player = playerSnap.data() || {};
    const before = n(player.credits);
    const after = before + economy.totalRevenue;

    t.update(playerRef, {
      credits: after,
      updatedAt: FieldValue.serverTimestamp(),
      lastMatchEconomy: economy,
      [`matchEconomy.${matchId}`]: economy,
    });

    t.set(txRef, {
      userId: uid,
      amount: economy.totalRevenue,
      currency: 'credits',
      type: 'MATCH_REVENUE',
      referenceId: matchId,
      description: 'Official league match revenue',
      matchEconomy: economy,
      balanceBefore: before,
      balanceAfter: after,
      timestamp: FieldValue.serverTimestamp(),
    });
  });
}
