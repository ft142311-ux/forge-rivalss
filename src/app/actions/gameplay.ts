
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { z } from 'zod';
import { Player, calculatePlayerMarketValue } from '@/app/lib/moba-data';
import { requireServerActor } from '@/lib/server-auth';
import { hash32 } from '@/app/lib/hash-utils';

/**
 * @fileOverview Защищенный слой игровых действий.
 * Обрабатывает тренировки, состав и трансферы.
 */

const LineupSlotSchema = z.enum([
  'carry', 'mid', 'offlane', 'support', 'full_support',
  'sub_carry', 'sub_mid', 'sub_offlane', 'sub_support', 'sub_full_support',
  'res1', 'res2', 'res3', 'res4', 'res5', 'res6', 'res7', 'res8'
]);

// Validate the complete client payload before opening a Firestore transaction.
// A caller must not be able to send unbounded keys/values or silently smuggle
// unsupported tactical fields into the persisted manager document.
const LineupUpdatesSchema = z.record(z.string(), z.string().nullable()).superRefine((value, ctx) => {
  const entries = Object.entries(value);
  if (entries.length > 18) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TOO_MANY_LINEUP_SLOTS' });
  }
  for (const [slot, playerId] of entries) {
    if (!LineupSlotSchema.safeParse(slot).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_LINEUP_SLOT' });
    }
    if (playerId !== null && (typeof playerId !== 'string' || playerId.length < 1 || playerId.length > 128)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_PLAYER_ID' });
    }
  }
});

const TacticalProfileSchema = z.object({
  direction: z.enum(['easy', 'mid', 'hard']),
  style: z.enum(['offense', 'control', 'aggressive']),
  pressing: z.enum(['low', 'medium', 'high']),
  rigidity: z.enum(['low', 'medium', 'high']),
  tempo: z.enum(['slow', 'medium', 'fast', 'careful', 'balanced']),
  risk: z.enum(['cautious', 'balanced', 'aggressive']),
  range: z.enum(['close', 'medium', 'long']),
  aggression: z.enum(['low', 'medium', 'high']).optional(),
  // Draft preferences are manager-owned settings consumed by the canonical match core.
  // Keep validation bounded so this remains safe to persist from a client action.
  draftPreferences: z.object({
    preferredHeroes: z.array(z.string().trim().min(1).max(64)).max(5).optional(),
    bannedHeroes: z.array(z.string().trim().min(1).max(64)).max(2).optional(),
    rolePreferences: z.record(z.array(z.string().trim().min(1).max(64)).max(20)).optional(),
  }).strict().optional(),
}).strict();

/**
 * Смена состава.
 */
export async function updateLineupAction(idToken: string, updates: Record<string, string | null>) {
  const { uid: userId } = await requireServerActor(idToken);
  const parsedUpdates = LineupUpdatesSchema.safeParse(updates);
  if (!parsedUpdates.success) return { success: false, error: parsedUpdates.error.issues[0]?.message || 'INVALID_LINEUP' };
  updates = parsedUpdates.data;
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(userId);

  try {
    await db.runTransaction(async (t) => {
      const pSnap = await t.get(playerRef);
      if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");
      
      const pData = pSnap.data()!;
      const currentLineup = pData.lineup || {};
      const ownedPlayers: Player[] = pData.ownedPlayers || [];
      const ownedIds = new Set(ownedPlayers.map(p => p.id));

      const newLineup = { ...currentLineup };
      
      for (const [slot, playerId] of Object.entries(updates)) {
        if (!LineupSlotSchema.safeParse(slot).success) continue;
        if (playerId && !ownedIds.has(playerId)) throw new Error("UNIT_NOT_OWNED");
        newLineup[slot] = playerId;
      }

      const activeSlots = ['carry', 'mid', 'offlane', 'support', 'full_support'];
      const activeIds = activeSlots.map(slot => newLineup[slot]).filter(Boolean) as string[];
      if (new Set(activeIds).size !== activeIds.length) throw new Error("DUPLICATE_STARTER");
      const activePlayers = activeIds.map(id => ownedPlayers.find(p => p.id === id)).filter(Boolean) as Player[];
      if (activePlayers.length === 5) {
        const activeRoles = activeSlots.map(slot => ({
          slot,
          playerId: newLineup[slot],
          role: slot === 'carry' ? 'Carry' : slot === 'mid' ? 'Midlaner' : slot === 'offlane' ? 'Tank' : slot === 'support' ? 'Jungler' : 'Support'
        }));
        const roleSet = new Set(activeRoles.map(x => x.role));
        if (roleSet.size !== 5) throw new Error("DUPLICATE_ROLE");
        activeRoles.forEach(({playerId, role}) => {
          const idx = ownedPlayers.findIndex(p => p.id === playerId);
          if (idx >= 0) ownedPlayers[idx] = { ...ownedPlayers[idx], currentRole: role as any };
        });
      }

      t.update(playerRef, {
        lineup: newLineup,
        ownedPlayers,
        lineupUpdatedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}


/** Persist the expanded pre-match tactical profile. */
export async function updateTacticsAction(idToken: string, strategy: string, tactics: Record<string, any>) {
  const { uid: userId } = await requireServerActor(idToken);
  const parsedTactics = TacticalProfileSchema.safeParse(tactics);
  const safeStrategy = typeof strategy === 'string' ? strategy.trim() : '';
  if (!parsedTactics.success) return { success: false, error: 'INVALID_TACTICS' };
  if (!safeStrategy || safeStrategy.length > 64 || /[\u0000-\u001f\u007f]/.test(safeStrategy)) {
    return { success: false, error: 'INVALID_STRATEGY' };
  }
  const safeTactics = parsedTactics.data;
  const db = getAdminDb();
  try {
    await db.collection('players_v14').doc(userId).update({
      strategy: safeStrategy,
      tactics: safeTactics,
      tacticalSettings: safeTactics,
      updatedAt: FieldValue.serverTimestamp()
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TACTICS_UPDATE_FAILED' };
  }
}

/** Persist the player's long-term training focus. */
export async function setTrainingFocusAction(idToken: string, playerId: string, focus: string | null) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();
  try {
    await db.runTransaction(async t => {
      const ref = db.collection('players_v14').doc(userId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const players: Player[] = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
      const idx = players.findIndex(p => p.id === playerId);
      if (idx < 0) throw new Error('UNIT_NOT_FOUND');
      const p: any = players[idx];
      players[idx] = { ...p, trainingFocus: focus, dailyTrainingFocus: focus, trainingProgress: p.trainingProgress || {}, skillCaps: p.skillCaps || {}, skillInclinations: p.skillInclinations || {} };
      t.update(ref, { ownedPlayers: players, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TRAINING_FOCUS_FAILED' };
  }
}

/**
 * Тренировка игрока.
 */
export async function startDailyTrainingAction(idToken: string, playerId: string, focus: string) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(userId);

  try {
    await db.runTransaction(async (t) => {
      const pSnap = await t.get(playerRef);
      if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");
      
      const pData = pSnap.data()!;
      const players: Player[] = pData.ownedPlayers || [];
      const idx = players.findIndex(p => p.id === playerId);
      if (idx === -1) throw new Error("UNIT_NOT_FOUND");

      const player = players[idx];
      if (player.dailyTrainingFinishTime) throw new Error("TRAINING_ALREADY_IN_PROGRESS");

      // 24 часа от текущего времени сервера
      const finishTime = new Date(Date.now() + 24 * 3600000).toISOString();
      
      players[idx] = {
        ...player,
        dailyTrainingFocus: focus,
        dailyTrainingFinishTime: finishTime
      };

      t.update(playerRef, {
        ownedPlayers: players,
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Инициализация выставления на трансфер.
 */
export async function listPlayerOnMarketAction(idToken: string, playerId: string) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(userId);

  try {
    return await db.runTransaction(async (t) => {
      const pSnap = await t.get(playerRef);
      if (!pSnap.exists) throw new Error("PLAYER_NOT_FOUND");
      
      const pData = pSnap.data()!;
      const players: Player[] = pData.ownedPlayers || [];
      const idx = players.findIndex(p => p.id === playerId);
      if (idx === -1) throw new Error("UNIT_NOT_FOUND");

      const player = players[idx];
      if (player.onTransferUntil) throw new Error("ALREADY_ON_MARKET");

      const expiry = new Date(Date.now() + 12 * 3600000).toISOString();
      const price = calculatePlayerMarketValue(player);
      
      const agentId = `market_${userId}_${Date.now()}`;
      const marketRef = db.collection('market_v7').doc(agentId);

      // 1. Создаем лот
      t.set(marketRef, {
        id: agentId,
        heroData: player,
        currentBid: price,
        startingPrice: price,
        sellerId: userId,
        sellerName: pData.displayName || "Manager",
        expiresAt: expiry,
        bidders: [],
        createdAt: FieldValue.serverTimestamp(),
        version: 140
      });

      // 2. Блокируем игрока у владельца
      players[idx] = { ...player, onTransferUntil: expiry, transferMarketId: agentId };
      t.update(playerRef, { ownedPlayers: players });

      return { success: true, agentId };
    });
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Place a bid on an active transfer-market lot.
 *
 * Kept deliberately compatible with the existing quick-search UI: the action
 * accepts (idToken, marketId, amount). All validation is performed in one
 * Firestore transaction so two managers cannot both become the leading bidder
 * against the same previous price.
 */
export async function placePlayerBidAction(idToken: string, marketId: string, amount: number) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();

  try {
    const bid = Number(amount);
    if (!marketId || !Number.isFinite(bid) || bid <= 0) {
      throw new Error('INVALID_BID');
    }

    return await db.runTransaction(async (t) => {
      const marketRef = db.collection('market_v7').doc(String(marketId));
      const bidderRef = db.collection('players_v14').doc(userId);
      const marketSnap = await t.get(marketRef);
      if (!marketSnap.exists) throw new Error('MARKET_LOT_NOT_FOUND');

      const lot: any = marketSnap.data() || {};
      if (lot.sellerId === userId) throw new Error('SELLER_CANNOT_BID');

      const expiresAt = lot.expiresAt ? new Date(lot.expiresAt).getTime() : 0;
      if (expiresAt && expiresAt <= Date.now()) throw new Error('MARKET_LOT_EXPIRED');

      const currentBid = Number(lot.currentBid || lot.startingPrice || 0);
      if (bid <= currentBid) throw new Error('BID_TOO_LOW');

      const bidderSnap = await t.get(bidderRef);
      if (!bidderSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const bidderData: any = bidderSnap.data() || {};

      const displayName = bidderData.displayName || bidderData.name || 'Manager';
      const previousBidders = Array.isArray(lot.bidders) ? lot.bidders : [];
      const bidders = previousBidders.filter((entry: any) => {
        const id = entry?.userId || entry?.bidderId || entry?.uid;
        return id !== userId;
      });
      bidders.push({
        userId,
        bidderId: userId,
        bidderName: displayName,
        amount: bid,
        createdAt: new Date().toISOString(),
      });

      t.update(marketRef, {
        currentBid: bid,
        highestBidderId: userId,
        highestBidderName: displayName,
        bidders,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        marketId: String(marketId),
        currentBid: bid,
        highestBidderId: userId,
      };
    });
  } catch (e: any) {
    return { success: false, error: e?.message || 'BID_FAILED' };
  }
}

/**
 * Apply persistent consequences after an authoritative match.
 * Training is based on minutes played; fatigue/form/tilt are part of the
 * player's state, while talent only influences the growth rate toward a cap.
 */
export async function applyMatchConsequencesAction(
  idToken: string,
  matchId: string,
  matchType: string,
  playerIds: string[],
  minutesPlayed: number
) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();
  try {
    await db.runTransaction(async t => {
      const ref = db.collection('players_v14').doc(userId);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('PLAYER_NOT_FOUND');
      const data = snap.data() || {};
      const players: Player[] = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
      const ids = new Set(playerIds);
      const official = ['league', 'cup', 'association'].includes(String(matchType).toLowerCase());
      const now = Date.now();
      const hash = (value: string) => hash32(value) / 4294967296;

      const updated = players.map(player => {
        if (!ids.has(player.id)) return player;
        const focus = player.trainingFocus || player.dailyTrainingFocus;
        const progress = { ...(player.trainingProgress || {}) };
        const caps = { ...(player.skillCaps || {}) };
        const inclinations = { ...(player.skillInclinations || {}) };
        const stats = { ...(player.proStats || {}) } as Record<string, number>;
        const talents = { ...(player.proTalents || {}) } as Record<string, number>;
        let nextFatigue = Math.max(0, Number(player.fatigue ?? 100) - (official ? 16 : 9));
        let nextForm = Math.max(35, Math.min(100, Number(player.form ?? 100) + (Number(minutesPlayed) >= 45 ? 1 : -1)));
        let tilt = Math.max(0, Number(player.tilt || 0));

        if (focus && Object.prototype.hasOwnProperty.call(stats, focus)) {
          const current = Math.max(0, Number(stats[focus] || 0));
          const talent = Math.max(0, Number(talents[focus] || 40));
          const cap = Math.max(current + 1, Number(caps[focus] || Math.min(100, 45 + talent * 0.55)));
          caps[focus] = cap;
          const currentProgress = Number(progress[focus] || 0);
          const age = Number(player.age || player.baseAge || 20);
          const ageFactor = age < 22 ? 1.22 : age < 25 ? 1.08 : age < 29 ? 0.94 : 0.78;
          const talentFactor = 0.70 + talent / 100;
          const ceilingFactor = current >= cap * 0.90 ? 0.25 : current >= cap * 0.80 ? 0.55 : 1;
          const minutesFactor = Math.max(0, Math.min(1.25, Number(minutesPlayed) / 90));
          const gain = 0.35 * ageFactor * talentFactor * ceilingFactor * minutesFactor;
          const nextProgress = currentProgress + gain;
          if (nextProgress >= 1 && current < cap) {
            stats[focus] = Math.min(cap, current + Math.max(1, Math.floor(nextProgress)));
            progress[focus] = nextProgress - Math.floor(nextProgress);
          } else {
            progress[focus] = nextProgress;
          }
        }

        // High-risk tactical choices can produce tilt/disciplinary consequences.
        const tactics = data.tactics || {};
        const risk = (tactics.aggression === 'high' ? 0.045 : 0.015) + (tactics.pressing === 'high' ? 0.02 : 0);
        const resistance = Math.max(0, Math.min(100, Number(player.proStats?.tiltResistance || 0)));
        const eventRoll = hash(`${matchId}:${player.id}:discipline`);
        if (eventRoll < risk * (1 - resistance / 180)) {
          tilt = Math.min(100, tilt + 15);
          if (official && eventRoll < risk * 0.22) {
            const days = 1 + Math.floor(hash(`${matchId}:${player.id}:ban`) * 3);
            player = { ...player, suspensionUntil: new Date(now + days * 86400000).toISOString(), warningCount: Number(player.warningCount || 0) + 1 };
          }
        } else if (tilt > 0 && nextForm > 70) {
          tilt = Math.max(0, tilt - 6);
        }

        return { ...player, proStats: stats, trainingProgress: progress, skillCaps: caps, skillInclinations: inclinations, fatigue: nextFatigue, form: nextForm, tilt };
      });
      t.update(ref, { ownedPlayers: updated, updatedAt: FieldValue.serverTimestamp(), lastMatchConsequences: { matchId, matchType, minutesPlayed } });
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'MATCH_CONSEQUENCES_FAILED' };
  }
}
