import { FieldValue } from 'firebase-admin/firestore';
import { calculatePlayerMarketValue } from './moba-data';
import { resolveMarketBidExpiryMs } from './market-bid-guards';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';
import { readFoundationRoster } from '@/game/foundation/guards';

export function resolveMarketListingPrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('MARKET_PRICE_INVALID');
  }
  return value;
}

export function resolveYouthMarketStartingPrice(value: unknown): number {
  let rating: number;
  if (value === undefined || value === null) {
    rating = 0;
  } else {
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new Error('MARKET_PRICE_INVALID');
    }
    if (typeof value === 'string' && value.trim() === '') {
      throw new Error('MARKET_PRICE_INVALID');
    }
    rating = Number(value);
  }
  if (!Number.isFinite(rating) || rating < 0 || rating > 100) {
    throw new Error('MARKET_PRICE_INVALID');
  }
  const price = Math.max(1, Math.floor(rating * 5000 + 25000));
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error('MARKET_PRICE_INVALID');
  }
  return price;
}

function resolveListingIdentity(uid: string, playerId: string) {
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128) {
    throw new Error('INVALID_MARKET_SELLER');
  }
  if (typeof playerId !== 'string' || !playerId.trim() || playerId.length > 128) {
    throw new Error('INVALID_PLAYER_ID');
  }
}

function createMarketLotId(db: any, prefix: 'market' | 'youth') {
  // Allocate a random Firestore identity before the transaction callback. A
  // transaction retry therefore keeps its lot ID, and same-ms listings cannot collide.
  const suffix = db.collection('market_v7').doc().id;
  return `${prefix}_${suffix}`;
}

export async function createStandardMarketListingWithDb(
  db: any,
  uid: string,
  playerId: string,
  now = Date.now(),
) {
  resolveListingIdentity(uid, playerId);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_MARKET_TIME');

  const profileRef = db.collection('players_v14').doc(uid);
  const marketId = createMarketLotId(db, 'market');
  const marketRef = db.collection('market_v7').doc(marketId);
  const expiresAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();

  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const profile = profileSnap.data() || {};
    if (profile.ownedPlayers !== undefined && profile.ownedPlayers !== null &&
        !Array.isArray(profile.ownedPlayers)) {
      throw new Error('PLAYER_ROSTER_INVALID');
    }
    const players: any[] = Array.isArray(profile.ownedPlayers) ? [...profile.ownedPlayers] : [];
    const matches = players.filter((player: any) => String(player?.id || '') === playerId);
    if (matches.length === 0) throw new Error('UNIT_NOT_FOUND');
    if (matches.length !== 1) throw new Error('PLAYER_OWNERSHIP_AMBIGUOUS');

    const playerIndex = players.findIndex((player: any) => String(player?.id || '') === playerId);
    const player = players[playerIndex];
    if (player.onTransferUntil) throw new Error('ALREADY_ON_MARKET');
    const price = resolveMarketListingPrice(calculatePlayerMarketValue(player));

    tx.create(marketRef, {
      id: marketId,
      heroData: player,
      currentBid: price,
      startingPrice: price,
      highestBidderId: null,
      highestBidderName: null,
      sellerId: uid,
      sellerName: String(profile.displayName || 'Manager').slice(0, 80),
      marketType: 'player',
      currency: 'credits',
      expiresAt,
      bidders: [],
      createdAt: FieldValue.serverTimestamp(),
      version: 140,
    });
    players[playerIndex] = { ...player, onTransferUntil: expiresAt, transferMarketId: marketId };
    tx.update(profileRef, { ownedPlayers: players, updatedAt: FieldValue.serverTimestamp() });

    return { success: true, agentId: marketId, expiresAt };
  });
}

export async function createYouthMarketListingWithDb(
  db: any,
  uid: string,
  playerId: string,
  now = Date.now(),
) {
  resolveListingIdentity(uid, playerId);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_MARKET_TIME');

  const profileRef = db.collection('players_v14').doc(uid);
  const marketId = createMarketLotId(db, 'youth');
  const marketRef = db.collection('market_v7').doc(marketId);
  const expiresAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();

  return db.runTransaction(async (tx: any) => {
    await assertStagingSeasonOneResetNotInProgress(tx, db);
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) throw new Error('PLAYER_NOT_FOUND');

    const profile = profileSnap.data() || {};
    if (profile.youthAcademyPlayers !== undefined && profile.youthAcademyPlayers !== null && !Array.isArray(profile.youthAcademyPlayers)) {
      throw new Error('YOUTH_ROSTER_INVALID');
    }
    const players: any[] = readFoundationRoster(profile.youthAcademyPlayers ?? []);
    const ownedPlayers: any[] = readFoundationRoster(profile.ownedPlayers ?? []);
    if (ownedPlayers.some((player: any) => String(player?.id || '') === playerId)) {
      throw new Error('PLAYER_OWNERSHIP_AMBIGUOUS');
    }
    const matches = players.filter((player: any) => String(player?.id || '') === playerId);
    if (matches.length === 0) throw new Error('YOUTH_PLAYER_NOT_OWNED');
    if (matches.length !== 1) throw new Error('YOUTH_PLAYER_DUPLICATE');

    const playerIndex = players.findIndex((player: any) => String(player?.id || '') === playerId);
    const player = players[playerIndex];
    const lockExpiryMs = resolveMarketBidExpiryMs(player.onTransferUntil);
    if (player.transferMarketId || (player.onTransferUntil && (lockExpiryMs === null || lockExpiryMs > now))) {
      throw new Error('PLAYER_ALREADY_ON_MARKET');
    }
    if (player.dailyTrainingFinishTime) throw new Error('YOUTH_TRAINING_IN_PROGRESS');
    if (player.isYouth === false) throw new Error('YOUTH_PLAYER_INVALID');
    const startingPrice = resolveYouthMarketStartingPrice(player.overallRating);
    const listedPlayer = { ...player, onTransferUntil: expiresAt, transferMarketId: marketId };

    tx.create(marketRef, {
      id: marketId,
      heroData: JSON.parse(JSON.stringify(listedPlayer)),
      currentBid: startingPrice,
      startingPrice,
      highestBidderId: null,
      highestBidderName: null,
      bidders: [],
      sellerId: uid,
      sellerName: String(profile.displayName || profile.clubName || 'Manager').slice(0, 80),
      expiresAt,
      dropDate: new Date(now).toISOString().slice(0, 10),
      dropTime: new Date(now).toISOString(),
      isYouth: true,
      currency: 'credits',
      createdAt: FieldValue.serverTimestamp(),
    });
    players[playerIndex] = listedPlayer;
    tx.update(profileRef, { youthAcademyPlayers: players, updatedAt: FieldValue.serverTimestamp() });

    return { success: true, marketId, expiresAt };
  });
}
