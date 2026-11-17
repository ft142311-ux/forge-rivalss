
'use server';

import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { z } from 'zod';
import { Player, calculatePlayerMarketValue } from '@/app/lib/moba-data';
import { requireServerActor } from '@/lib/server-auth';
import { hash32 } from '@/app/lib/hash-utils';
import { MATCH_REPORT_COLLECTIONS } from '@/app/lib/match-storage';
import { resolveMarketBidExpiryMs, resolveMarketBidPrice } from '@/app/lib/market-bid-guards';
import { normalizeAuctionBalance, resolveAuctionCurrency, resolvePreviousAuctionBidEscrow } from '@/app/lib/auction-settlement';

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
    const bid = amount;
    if (typeof marketId !== 'string' || !marketId.trim() || marketId.length > 180 ||
        typeof bid !== 'number' || !Number.isSafeInteger(bid) || bid <= 0) {
      throw new Error('INVALID_BID');
    }

    // Stable ledger references survive Firestore transaction retries.
    const bidderLedgerRef = db.collection('economy_transactions').doc();
    const refundLedgerRef = db.collection('economy_transactions').doc();

    return await db.runTransaction(async (t) => {
      const marketRef = db.collection('market_v7').doc(marketId);
      const bidderRef = db.collection('players_v14').doc(userId);
      const marketSnap = await t.get(marketRef);
      if (!marketSnap.exists) throw new Error('MARKET_LOT_NOT_FOUND');

      const lot: any = marketSnap.data() || {};
      if (lot.isPro === true || lot.isYouth === true) throw new Error('INVALID_MARKET_LOT_TYPE');
      if (lot.sellerId === userId) throw new Error('SELLER_CANNOT_BID');

      const currency = resolveAuctionCurrency(lot.currency);
      if (currency !== 'credits') throw new Error('INVALID_MARKET_CURRENCY');

      const expiresAt = resolveMarketBidExpiryMs(lot.expiresAt);
      if (expiresAt === null) throw new Error('MARKET_EXPIRY_INVALID');
      const now = Date.now();
      if (expiresAt <= now) throw new Error('MARKET_LOT_EXPIRED');

      const currentBid = resolveMarketBidPrice(lot.currentBid, lot.startingPrice);
      if (currentBid === null) throw new Error('MARKET_PRICE_INVALID');
      if (bid <= currentBid) throw new Error('BID_TOO_LOW');

      const bidderSnap = await t.get(bidderRef);
      if (!bidderSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const bidderData: any = bidderSnap.data() || {};

      const previousBidderId = String(lot.highestBidderId || lot.highestBidderUid || '');
      const previousEscrow = resolvePreviousAuctionBidEscrow({
        currency,
        escrowCurrency: lot.escrowCurrency,
        escrowedAmount: lot.escrowedAmount,
        currentBid,
        previousBidderId,
      });
      const sameEscrowedBidder = previousBidderId === userId && previousEscrow === currentBid;
      const chargeAmount = sameEscrowedBidder ? bid - currentBid : bid;
      const bidderBalance = normalizeAuctionBalance(bidderData.credits);
      if (bidderBalance < chargeAmount) throw new Error('INSUFFICIENT_FUNDS');

      let previousBidderRef: DocumentReference | null = null;
      let previousBidder: any = null;
      if (previousBidderId && previousBidderId !== userId && previousEscrow > 0) {
        previousBidderRef = db.collection('players_v14').doc(previousBidderId);
        const previousBidderSnap = await t.get(previousBidderRef);
        if (!previousBidderSnap.exists) throw new Error('PREVIOUS_BIDDER_NOT_FOUND');
        previousBidder = previousBidderSnap.data() || {};
      }

      const displayName = String(bidderData.displayName || bidderData.name || 'Manager').slice(0, 80);
      const previousBidders = Array.isArray(lot.bidders) ? [...lot.bidders] : [];
      const bidders = previousBidders.filter((entry: any) => {
        const id = typeof entry === 'string' ? entry : entry?.userId || entry?.bidderId || entry?.uid;
        return id !== userId;
      });
      bidders.push({
        userId,
        bidderId: userId,
        bidderName: displayName,
        amount: bid,
        createdAt: new Date(now).toISOString(),
      });

      const nextExpiry = expiresAt - now < 10 * 60 * 1000 ? now + 10 * 60 * 1000 : expiresAt;
      t.update(bidderRef, {
        credits: bidderBalance - chargeAmount,
        updatedAt: FieldValue.serverTimestamp(),
      });
      t.set(bidderLedgerRef, {
        userId,
        amount: -chargeAmount,
        currency,
        type: 'SPECIAL_AUCTION_BID_ESCROW',
        referenceId: marketId,
        description: 'Escrow for standard transfer-market bid',
        balanceBefore: bidderBalance,
        balanceAfter: bidderBalance - chargeAmount,
        timestamp: FieldValue.serverTimestamp(),
      });

      if (previousBidderRef && previousBidder) {
        const previousBalance = normalizeAuctionBalance(previousBidder.credits);
        const refundedBalance = previousBalance + previousEscrow;
        t.update(previousBidderRef, {
          credits: refundedBalance,
          updatedAt: FieldValue.serverTimestamp(),
        });
        t.set(refundLedgerRef, {
          userId: previousBidderId,
          amount: previousEscrow,
          currency,
          type: 'SPECIAL_AUCTION_OUTBID_REFUND',
          referenceId: marketId,
          description: 'Refund after being outbid in standard transfer market',
          balanceBefore: previousBalance,
          balanceAfter: refundedBalance,
          timestamp: FieldValue.serverTimestamp(),
        });
      }

      t.update(marketRef, {
        currentBid: bid,
        highestBidderId: userId,
        highestBidderName: displayName,
        bidders,
        escrowedAmount: bid,
        escrowCurrency: currency,
        expiresAt: new Date(nextExpiry).toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        marketId,
        currentBid: bid,
        highestBidderId: userId,
        expiresAt: new Date(nextExpiry).toISOString(),
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
  _minutesPlayed: number
) {
  const { uid: userId } = await requireServerActor(idToken);
  const db = getAdminDb();
  try {
    const safeMatchId = typeof matchId === 'string' ? matchId.trim() : '';
    const safeMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
    if (!safeMatchId || safeMatchId.length > 180 || !/^[A-Za-z0-9_-]+$/.test(safeMatchId)) {
      throw new Error('INVALID_MATCH_ID');
    }
    if (!safeMatchType) throw new Error('INVALID_MATCH_TYPE');
    if (!Array.isArray(playerIds) || playerIds.length > 10 ||
        playerIds.some(id => typeof id !== 'string' || !id.trim())) {
      throw new Error('INVALID_MATCH_PLAYER_IDS');
    }
    const requestedIds = [...new Set(playerIds.map(id => id.trim()))];
    if (requestedIds.length !== playerIds.length) throw new Error('DUPLICATE_MATCH_PLAYER_IDS');

    let matchRef: DocumentReference | null = null;
    for (const collectionName of MATCH_REPORT_COLLECTIONS) {
      const candidate = db.collection(collectionName).doc(safeMatchId);
      const snapshot = await candidate.get();
      if (snapshot.exists) {
        matchRef = candidate;
        break;
      }
    }
    if (!matchRef) throw new Error('MATCH_NOT_FOUND');
    const resolvedMatchRef = matchRef;

    const receiptRef = db.collection('match_consequence_receipts').doc(`${userId}_${safeMatchId}`);
    const transactionResult = await db.runTransaction(async t => {
      const profileRef = db.collection('players_v14').doc(userId);
      const [matchSnap, profileSnap, receiptSnap] = await Promise.all([
        t.get(resolvedMatchRef),
        t.get(profileRef),
        t.get(receiptRef),
      ]);
      if (receiptSnap.exists) return { duplicate: true };
      if (!matchSnap.exists) throw new Error('MATCH_NOT_FOUND');
      if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');
      const match: any = matchSnap.data() || {};
      const storedMatchType = String(match.matchType || match.type || 'league').toLowerCase();
      if (storedMatchType !== safeMatchType) throw new Error('MATCH_TYPE_MISMATCH');
      if (match.isFinished !== true && !['finished', 'completed'].includes(String(match.status || '').toLowerCase())) {
        throw new Error('MATCH_NOT_FINISHED');
      }

      const homeId = String(match.homeId ?? match.hostId ?? match.teamAId ?? '');
      const awayId = String(match.awayId ?? match.challengerId ?? match.teamBId ?? '');
      const isHome = homeId === userId;
      const isAway = awayId === userId;
      if (!isHome && !isAway) throw new Error('MATCH_ACCESS_DENIED');

      const simulation = match.simulation || {};
      const actualRoles = isHome ? simulation.homeRoles : simulation.awayRoles;
      if (!Array.isArray(actualRoles) || actualRoles.length === 0) {
        throw new Error('MATCH_LINEUP_SNAPSHOT_MISSING');
      }
      const actualPlayerIds = [...new Set(actualRoles
        .map((role: any) => String(role?.playerId || ''))
        .filter((id: string) => id && !id.startsWith('BOT_') && !id.startsWith('bot_')))];
      if (requestedIds.some(id => !actualPlayerIds.includes(id))) {
        throw new Error('MATCH_PLAYER_NOT_USED');
      }

      const games = Array.isArray(match.games) ? match.games : Array.isArray(simulation.games) ? simulation.games : [];
      const minutesPlayed = games.reduce((total: number, game: any) => {
        const duration = String(game?.duration || '');
        const parsed = duration.match(/^(\d{1,3}):(\d{2})$/);
        return parsed ? total + Number(parsed[1]) + Number(parsed[2]) / 60 : total;
      }, 0);
      if (!Number.isFinite(minutesPlayed) || minutesPlayed <= 0) {
        throw new Error('MATCH_MINUTES_UNAVAILABLE');
      }
      const verifiedMinutesPlayed = Math.min(120, Math.round(minutesPlayed));

      const data = profileSnap.data() || {};
      const players: Player[] = Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [];
      const ownedIds = new Set(players.map(player => String(player.id)));
      const ids = new Set(requestedIds.length ? requestedIds : actualPlayerIds.filter(id => ownedIds.has(id)));
      for (const id of ids) {
        if (!ownedIds.has(id)) throw new Error('MATCH_PLAYER_NOT_OWNED');
      }
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
        let nextFatigue = Math.max(0, Number(player.fatigue ?? 100) - (['league', 'cup', 'association'].includes(safeMatchType) ? 16 : 9));
        let nextForm = Math.max(35, Math.min(100, Number(player.form ?? 100) + (verifiedMinutesPlayed >= 45 ? 1 : -1)));
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
          const minutesFactor = Math.max(0, Math.min(1.25, verifiedMinutesPlayed / 90));
          const gain = 0.35 * ageFactor * talentFactor * ceilingFactor * minutesFactor;
          const nextProgress = currentProgress + gain;
          if (nextProgress >= 1 && current < cap) {
            stats[focus] = Math.min(cap, current + Math.max(1, Math.floor(nextProgress)));
            progress[focus] = nextProgress - Math.floor(nextProgress);
          } else {
            progress[focus] = nextProgress;
          }
        }

        const tactics = data.tactics || {};
        const risk = (tactics.aggression === 'high' ? 0.045 : 0.015) + (tactics.pressing === 'high' ? 0.02 : 0);
        const resistance = Math.max(0, Math.min(100, Number(player.proStats?.tiltResistance || 0)));
        const eventRoll = hash(`${safeMatchId}:${player.id}:discipline`);
        if (eventRoll < risk * (1 - resistance / 180)) {
          tilt = Math.min(100, tilt + 15);
          if (['league', 'cup', 'association'].includes(safeMatchType) && eventRoll < risk * 0.22) {
            const days = 1 + Math.floor(hash(`${safeMatchId}:${player.id}:ban`) * 3);
            player = { ...player, suspensionUntil: new Date(now + days * 86400000).toISOString(), warningCount: Number(player.warningCount || 0) + 1 };
          }
        } else if (tilt > 0 && nextForm > 70) {
          tilt = Math.max(0, tilt - 6);
        }

        return { ...player, proStats: stats, trainingProgress: progress, skillCaps: caps, skillInclinations: inclinations, fatigue: nextFatigue, form: nextForm, tilt };
      });
      t.update(profileRef, {
        ownedPlayers: updated,
        updatedAt: FieldValue.serverTimestamp(),
        lastMatchConsequences: { matchId: safeMatchId, matchType: safeMatchType, minutesPlayed: verifiedMinutesPlayed },
      });
      t.create(receiptRef, {
        userId,
        matchId: safeMatchId,
        matchType: safeMatchType,
        playerIds: [...ids],
        minutesPlayed: verifiedMinutesPlayed,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { duplicate: false };
    });
    return { success: true, duplicate: transactionResult.duplicate };
  } catch (e: any) {
    return { success: false, error: e?.message || 'MATCH_CONSEQUENCES_FAILED' };
  }
}