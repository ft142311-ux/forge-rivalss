import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runTransferMarketExpirySweepWithDb } from '../src/app/lib/auction-expiry-sweep.ts';
import { placeSpecialMarketBidWithDb, placeStandardMarketBidWithDb } from '../src/app/lib/auction-bid.ts';
import { createStandardMarketListingWithDb, createYouthMarketListingWithDb } from '../src/app/lib/market-listing.ts';
import { canPruneUnbidSystemAuctionLot, normalizeAuctionUserId, resolveAuctionBidderId } from '../src/app/lib/auction-settlement.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

async function withIsolatedFirestore(t) {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');
  const app = initializeApp({ projectId }, `auction-expiry-test-${randomUUID()}`);
  const firestore = getFirestore(app);
  const prefix = `auctionExpiryTest_${randomUUID().replaceAll('-', '')}_`;
  const names = ['market_v7', 'players_v14', 'economy_transactions', 'transfer_history', 'notifications_v7', 'system_v1', 'system_jobs_v1'];
  const db = {
    collection: name => firestore.collection(prefix + name),
    runTransaction: callback => firestore.runTransaction(callback),
  };
  t.after(async () => {
    await Promise.all(names.map(async name => {
      const snapshot = await db.collection(name).get();
      if (!snapshot.empty) {
        const batch = firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }));
    await deleteApp(app);
  });
  return { db, names };
}

function expiredLot(overrides = {}) {
  return {
    sellerId: 'seller-1',
    highestBidderId: 'buyer-1',
    currentBid: 1000,
    startingPrice: 500,
    currency: 'credits',
    escrowCurrency: 'credits',
    escrowedAmount: 1000,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    heroData: { id: 'hero-1', name: 'Test Hero', power: 50 },
    isYouth: false,
    ...overrides,
  };
}


test('Firestore Emulator blocks standard and special bids while a fresh Season 1 reset is active', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await db.collection('system_v1').doc('season_config').set({
    stagingSeasonOneResetInProgress: true,
    worldReady: false,
  });
  await db.collection('players_v14').doc('standard-buyer').set({ credits: 1000, ownedPlayers: [] });
  await db.collection('players_v14').doc('pro-buyer').set({ crystals: 1000, ownedPlayers: [] });
  await db.collection('market_v7').doc('standard-reset-fence').set({
    sellerId: 'seller', currentBid: 100, startingPrice: 100, currency: 'credits',
    expiresAt, highestBidderId: null, bidders: [],
  });
  await db.collection('market_v7').doc('pro-reset-fence').set({
    sellerId: 'seller', currentBid: 100, startingPrice: 100, currency: 'crystals',
    isPro: true, expiresAt, highestBidderId: null, bidders: [],
    heroData: { id: 'pro-reset-player', name: 'Pro Reset Player' },
  });

  await assert.rejects(
    placeStandardMarketBidWithDb(db, 'standard-buyer', 'standard-reset-fence', 103),
    /STAGING_SEASON_ONE_RESET_IN_PROGRESS/,
  );
  await assert.rejects(
    placeSpecialMarketBidWithDb(db, 'pro-buyer', 'pro-reset-fence', 103, 'pro'),
    /STAGING_SEASON_ONE_RESET_IN_PROGRESS/,
  );

  assert.equal((await db.collection('players_v14').doc('standard-buyer').get()).get('credits'), 1000);
  assert.equal((await db.collection('players_v14').doc('pro-buyer').get()).get('crystals'), 1000);
  assert.equal((await db.collection('market_v7').doc('standard-reset-fence').get()).get('highestBidderId'), null);
  assert.equal((await db.collection('market_v7').doc('pro-reset-fence').get()).get('highestBidderId'), null);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('notifications_v7').get()).size, 0);
});

test('Firestore Emulator skips expiry sweeps when either fresh Season 1 reset marker is already active', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const lotRef = db.collection('market_v7').doc('reset-blocked-expiry');
  const configRef = db.collection('system_v1').doc('season_config');
  await lotRef.set(expiredLot({ sellerId: '', highestBidderId: null }));

  for (const marker of ['stagingSeasonOneResetInProgress', 'stagingFreshSeasonOneReset']) {
    await configRef.set({ [marker]: true }, { merge: true });
    const result = await runTransferMarketExpirySweepWithDb(db);
    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    assert.equal(result.scanned, 0);
    assert.equal((await lotRef.get()).exists, true);
    assert.equal((await db.collection('system_jobs_v1').doc('market_expiry_sweep').get()).exists, false);
    await configRef.set({ [marker]: false }, { merge: true });
  }
});

test('Firestore Emulator rechecks the fresh reset marker when it appears after sweep preflight', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const lotRef = db.collection('market_v7').doc('reset-race-expiry');
  const configRef = db.collection('system_v1').doc('season_config');
  const firestore = db.collection('system_v1').firestore;
  await lotRef.set(expiredLot({ sellerId: '', highestBidderId: null }));
  await configRef.set({ stagingFreshSeasonOneReset: false });

  const racedDb = {
    collection: name => db.collection(name),
    runTransaction: async callback => {
      // The initial config read has completed. Assert the reset marker before
      // the sweep tries to claim its transactionally fenced lease.
      await configRef.set({ stagingFreshSeasonOneReset: true }, { merge: true });
      return firestore.runTransaction(callback);
    },
  };

  const result = await runTransferMarketExpirySweepWithDb(racedDb);
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'STAGING_SEASON_ONE_RESET_IN_PROGRESS');
  assert.equal((await lotRef.get()).exists, true);
  assert.equal((await db.collection('system_jobs_v1').doc('market_expiry_sweep').get()).exists, false);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});



test('Firestore Emulator refunds the outbid manager and charges only the incremental amount for a same-bidder raise', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('seller-1').set({ crystals: 0, ownedPlayers: [] });
  await db.collection('players_v14').doc('bidder-1').set({ crystals: 1000, displayName: 'First', ownedPlayers: [] });
  await db.collection('players_v14').doc('bidder-2').set({ crystals: 1000, displayName: 'Second', ownedPlayers: [] });
  await db.collection('market_v7').doc('pro-lot').set({
    sellerId: 'seller-1', isPro: true, currency: 'crystals',
    currentBid: 200, startingPrice: 200, highestBidderId: null,
    bidders: [], expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'pro-player', name: 'Pro Player' },
  });

  await placeSpecialMarketBidWithDb(db, 'bidder-1', 'pro-lot', 300, 'pro', now);
  await placeSpecialMarketBidWithDb(db, 'bidder-2', 'pro-lot', 500, 'pro', now);
  await placeSpecialMarketBidWithDb(db, 'bidder-2', 'pro-lot', 600, 'pro', now);

  assert.equal((await db.collection('players_v14').doc('bidder-1').get()).get('crystals'), 1000);
  assert.equal((await db.collection('players_v14').doc('bidder-2').get()).get('crystals'), 400);
  const lot = await db.collection('market_v7').doc('pro-lot').get();
  assert.equal(lot.get('highestBidderId'), 'bidder-2');
  assert.equal(lot.get('currentBid'), 600);
  assert.equal(lot.get('escrowedAmount'), 600);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'pro-lot').get();
  const rows = ledger.docs.map(doc => doc.data());
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 900);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_OUTBID_REFUND').reduce((sum, row) => sum + row.amount, 0), 300);
  assert.equal((await db.collection('notifications_v7').where('userId', '==', 'bidder-1').get()).size, 1);
});



test('Firestore Emulator completes a PRO bid, outbid, incremental raise and expiry settlement as one economy flow', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('seller-1').set({
    crystals: 100,
    ownedPlayers: [{ id: 'pro-player', name: 'Pro Player', onTransferUntil: 'reserved', transferMarketId: 'pro-flow' }],
  });
  await db.collection('players_v14').doc('bidder-1').set({ crystals: 1000, ownedPlayers: [] });
  await db.collection('players_v14').doc('bidder-2').set({ crystals: 1000, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('pro-flow');
  await lotRef.set({
    sellerId: 'seller-1', isPro: true, currency: 'crystals',
    currentBid: 200, startingPrice: 200, highestBidderId: null,
    bidders: [], expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'pro-player', name: 'Pro Player' },
  });

  await placeSpecialMarketBidWithDb(db, 'bidder-1', 'pro-flow', 300, 'pro', now);
  await placeSpecialMarketBidWithDb(db, 'bidder-2', 'pro-flow', 500, 'pro', now);
  await placeSpecialMarketBidWithDb(db, 'bidder-2', 'pro-flow', 600, 'pro', now);

  assert.equal((await db.collection('players_v14').doc('bidder-1').get()).get('crystals'), 1000);
  assert.equal((await db.collection('players_v14').doc('bidder-2').get()).get('crystals'), 400);
  await lotRef.update({ expiresAt: new Date(now - 1).toISOString() });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 1);
  assert.equal(result.expiredWithoutSale, 0);
  assert.equal((await lotRef.get()).exists, false);

  const seller = await db.collection('players_v14').doc('seller-1').get();
  const firstBidder = await db.collection('players_v14').doc('bidder-1').get();
  const winner = await db.collection('players_v14').doc('bidder-2').get();
  assert.equal(seller.get('crystals'), 670, 'seller receives 600 less the 5% commission');
  assert.deepEqual(seller.get('ownedPlayers'), []);
  assert.equal(firstBidder.get('crystals'), 1000, 'outbid manager receives the full escrow refund');
  assert.equal(winner.get('crystals'), 400, 'winner is not charged a second time at settlement');
  assert.deepEqual(winner.get('ownedPlayers').map(player => player.id), ['pro-player']);

  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'pro-flow').get();
  const rows = ledger.docs.map(doc => doc.data());
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 900);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_OUTBID_REFUND').reduce((sum, row) => sum + row.amount, 0), 300);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_SETTLEMENT_CREDIT').reduce((sum, row) => sum + row.amount, 0), 570);
  assert.equal(rows.some(row => row.type === 'SPECIAL_AUCTION_SETTLEMENT_DEBIT'), false);
  assert.equal((await db.collection('transfer_history').get()).size, 1);
});


test('Firestore Emulator settles a system PRO drop without requiring or crediting a manager seller', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('system-buyer').set({
    crystals: 700,
    credits: 1200,
    ownedPlayers: [],
  });
  const lotRef = db.collection('market_v7').doc('system-pro-drop');
  await lotRef.set({
    sellerId: 'system',
    sellerName: 'System',
    isSystem: true,
    isPro: true,
    currency: 'crystals',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'system-pro-player', name: 'System PRO Player', isBot: true },
  });

  await placeSpecialMarketBidWithDb(db, 'system-buyer', 'system-pro-drop', 300, 'pro', now);
  assert.equal((await db.collection('players_v14').doc('system-buyer').get()).get('crystals'), 400);
  await lotRef.update({ expiresAt: new Date(now - 1).toISOString() });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 1);
  assert.equal((await lotRef.get()).exists, false);

  const buyer = await db.collection('players_v14').doc('system-buyer').get();
  assert.equal(buyer.get('crystals'), 400, 'system auction winner is not charged twice');
  assert.equal(buyer.get('credits'), 1200, 'system PRO auction never touches credits');
  assert.deepEqual(buyer.get('ownedPlayers').map(player => player.id), ['system-pro-player']);

  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'system-pro-drop').get();
  const rows = ledger.docs.map(doc => doc.data());
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 300);
  assert.equal(rows.some(row => row.type === 'SPECIAL_AUCTION_SETTLEMENT_CREDIT'), false);
  assert.equal(rows.some(row => row.type === 'SPECIAL_AUCTION_SETTLEMENT_DEBIT'), false);
  const transfer = (await db.collection('transfer_history').get()).docs[0];
  assert.equal(transfer.get('sellerType'), 'system');
  assert.equal(transfer.get('commission'), 0);
});


test('Firestore Emulator aborts a new bid when the previous bidder account is missing or escrow is corrupt', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('seller-1').set({ crystals: 0 });
  await db.collection('players_v14').doc('new-bidder').set({ crystals: 1000 });
  await db.collection('market_v7').doc('missing-previous-bidder').set({
    sellerId: 'seller-1', isPro: true, currency: 'crystals',
    currentBid: 300, startingPrice: 200, highestBidderId: 'deleted-bidder',
    escrowCurrency: 'crystals', escrowedAmount: 300,
    bidders: [], expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  });
  await db.collection('market_v7').doc('corrupt-previous-escrow').set({
    sellerId: 'seller-1', isPro: true, currency: 'crystals',
    currentBid: 300, startingPrice: 200, highestBidderId: 'old-bidder',
    escrowCurrency: 'credits', escrowedAmount: 300,
    bidders: [], expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  });
  await db.collection('players_v14').doc('old-bidder').set({ crystals: 1000 });

  await assert.rejects(
    placeSpecialMarketBidWithDb(db, 'new-bidder', 'missing-previous-bidder', 400, 'pro', now),
    /PREVIOUS_BIDDER_NOT_FOUND/,
  );
  await assert.rejects(
    placeSpecialMarketBidWithDb(db, 'new-bidder', 'corrupt-previous-escrow', 400, 'pro', now),
    /AUCTION_ESCROW_CURRENCY_MISMATCH/,
  );
  assert.equal((await db.collection('players_v14').doc('new-bidder').get()).get('crystals'), 1000);
  assert.equal((await db.collection('players_v14').doc('old-bidder').get()).get('crystals'), 1000);
  assert.equal((await db.collection('market_v7').doc('missing-previous-bidder').get()).get('highestBidderId'), 'deleted-bidder');
  assert.equal((await db.collection('market_v7').doc('corrupt-previous-escrow').get()).get('highestBidderId'), 'old-bidder');
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
});

test('Firestore Emulator keeps Youth bids in credits and applies the same escrow rules', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('seller-1').set({
    credits: 0,
    youthAcademyPlayers: [{ id: 'youth-player', name: 'Youth Player', onTransferUntil: expiresAt, transferMarketId: 'youth-lot' }],
  });
  await db.collection('players_v14').doc('youth-bidder').set({ credits: 800, crystals: 500 });
  await db.collection('market_v7').doc('youth-lot').set({
    sellerId: 'seller-1', isYouth: true, currency: 'credits',
    currentBid: 100, startingPrice: 100, highestBidderId: null,
    bidders: [], expiresAt, heroData: { id: 'youth-player', name: 'Youth Player' },
  });

  await placeSpecialMarketBidWithDb(db, 'youth-bidder', 'youth-lot', 250, 'youth', now);
  const bidder = await db.collection('players_v14').doc('youth-bidder').get();
  assert.equal(bidder.get('credits'), 550);
  assert.equal(bidder.get('crystals'), 500);
  const lot = await db.collection('market_v7').doc('youth-lot').get();
  assert.equal(lot.get('currency'), 'credits');
  assert.equal(lot.get('escrowCurrency'), 'credits');
  assert.equal(lot.get('escrowedAmount'), 250);
});

test('Firestore Emulator completes a Youth bid and expiry settlement in credits without touching crystals', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('youth-seller').set({
    credits: 100,
    crystals: 900,
    youthAcademyPlayers: [{ id: 'youth-player', name: 'Youth Player', onTransferUntil: expiresAt, transferMarketId: 'youth-flow' }],
  });
  await db.collection('players_v14').doc('youth-buyer').set({
    credits: 800,
    crystals: 500,
    youthAcademyPlayers: [],
  });
  const lotRef = db.collection('market_v7').doc('youth-flow');
  await lotRef.set({
    sellerId: 'youth-seller',
    isYouth: true,
    currency: 'credits',
    currentBid: 100,
    startingPrice: 100,
    highestBidderId: null,
    bidders: [],
    expiresAt,
    heroData: { id: 'youth-player', name: 'Youth Player' },
  });

  await placeSpecialMarketBidWithDb(db, 'youth-buyer', 'youth-flow', 250, 'youth', now);
  const afterBid = await db.collection('players_v14').doc('youth-buyer').get();
  assert.equal(afterBid.get('credits'), 550);
  assert.equal(afterBid.get('crystals'), 500);
  await lotRef.update({ expiresAt: new Date(now - 1).toISOString() });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 1);
  assert.equal(result.expiredWithoutSale, 0);
  assert.equal((await lotRef.get()).exists, false);

  const seller = await db.collection('players_v14').doc('youth-seller').get();
  const buyer = await db.collection('players_v14').doc('youth-buyer').get();
  assert.equal(seller.get('credits'), 338, 'seller receives 250 less the 5% commission');
  assert.equal(seller.get('crystals'), 900);
  assert.deepEqual(seller.get('youthAcademyPlayers'), []);
  assert.equal(buyer.get('credits'), 550, 'winner is not charged a second time');
  assert.equal(buyer.get('crystals'), 500);
  assert.deepEqual(buyer.get('youthAcademyPlayers').map(player => player.id), ['youth-player']);

  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'youth-flow').get();
  const rows = ledger.docs.map(doc => doc.data());
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 250);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_SETTLEMENT_CREDIT').reduce((sum, row) => sum + row.amount, 0), 238);
  assert.equal(rows.some(row => row.currency !== 'credits'), false);
  assert.equal((await db.collection('transfer_history').get()).size, 1);
});


test('Firestore Emulator serializes concurrent bids and rejects a stale lower bid without overcharging', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('seller-1').set({ crystals: 0 });
  await db.collection('players_v14').doc('bidder-1').set({ crystals: 1000, displayName: 'Bidder' });
  await db.collection('market_v7').doc('race-lot').set({
    sellerId: 'seller-1', isPro: true, currency: 'crystals',
    currentBid: 200, startingPrice: 200, highestBidderId: null,
    bidders: [], expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'race-player', name: 'Race Player' },
  });

  const outcomes = await Promise.allSettled([
    placeSpecialMarketBidWithDb(db, 'bidder-1', 'race-lot', 400, 'pro', now),
    placeSpecialMarketBidWithDb(db, 'bidder-1', 'race-lot', 500, 'pro', now),
  ]);
  assert.ok(outcomes.some(item => item.status === 'fulfilled'));
  const rejected = outcomes.find(item => item.status === 'rejected');
  if (rejected) assert.match(String(rejected.reason?.message || ''), /BID_TOO_LOW/);
  assert.equal((await db.collection('players_v14').doc('bidder-1').get()).get('crystals'), 500);
  const lot = await db.collection('market_v7').doc('race-lot').get();
  assert.equal(lot.get('currentBid'), 500);
  assert.equal(lot.get('escrowedAmount'), 500);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'race-lot').get();
  assert.equal(ledger.docs.reduce((sum, doc) => sum + Math.abs(doc.get('amount')), 0), 500);
});

test('Firestore Emulator settles a lot only once under concurrent expiry sweeps', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('seller-1').set({
    credits: 1000,
    ownedPlayers: [{ id: 'hero-1', name: 'Test Hero', onTransferUntil: 'expired', transferMarketId: 'lot-1' }],
  });
  // The bid escrow was already deducted when the bid was placed.
  await db.collection('players_v14').doc('buyer-1').set({
    credits: 1000,
    ownedPlayers: [],
  });
  await db.collection('market_v7').doc('lot-1').set(expiredLot());

  const results = await Promise.all([
    runTransferMarketExpirySweepWithDb(db),
    runTransferMarketExpirySweepWithDb(db),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.settled, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.sold, 0), 1);

  const buyer = await db.collection('players_v14').doc('buyer-1').get();
  const seller = await db.collection('players_v14').doc('seller-1').get();
  assert.equal(buyer.get('credits'), 1000, 'valid escrow must not be charged a second time');
  assert.deepEqual(buyer.get('ownedPlayers').map(player => player.id), ['hero-1']);
  assert.equal(seller.get('credits'), 1950, 'seller receives price less 5% commission');
  assert.deepEqual(seller.get('ownedPlayers'), []);

  assert.equal((await db.collection('market_v7').doc('lot-1').get()).exists, false);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'lot-1').get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_CREDIT');
  const transfers = await db.collection('transfer_history').get();
  assert.equal(transfers.size, 1);
});

test('Firestore Emulator refunds recorded escrow when the seller no longer owns the player', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('seller-1').set({ credits: 200, ownedPlayers: [] });
  await db.collection('players_v14').doc('buyer-1').set({ credits: 700, ownedPlayers: [] });
  await db.collection('market_v7').doc('lot-refund').set(expiredLot({
    currentBid: 300,
    startingPrice: 200,
    escrowedAmount: 300,
    heroData: { id: 'missing-player', name: 'Missing Player' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await db.collection('players_v14').doc('buyer-1').get()).get('credits'), 1000);
  assert.equal((await db.collection('players_v14').doc('seller-1').get()).get('credits'), 200);
  assert.equal((await db.collection('market_v7').doc('lot-refund').get()).exists, false);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'lot-refund').get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_REFUND');
  assert.equal(ledger.docs[0].get('balanceAfter'), 1000);
});

test('Firestore Emulator leaves lots untouched when recorded escrow or price is malformed', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('seller-1').set({
    credits: 200,
    ownedPlayers: [{ id: 'hero-1', name: 'Test Hero' }],
  });
  await db.collection('players_v14').doc('buyer-1').set({ credits: 700, ownedPlayers: [] });
  await db.collection('market_v7').doc('lot-corrupt-escrow').set(expiredLot({
    escrowedAmount: 'corrupt',
  }));
  await db.collection('market_v7').doc('lot-corrupt-price').set(expiredLot({
    currentBid: 'corrupt',
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, false);
  assert.ok(result.errors.some(error => /AUCTION_ESCROW_AMOUNT_INVALID/.test(error.error)));
  assert.ok(result.errors.some(error => /AUCTION_PRICE_INVALID/.test(error.error)));
  assert.equal((await db.collection('market_v7').doc('lot-corrupt-escrow').get()).exists, true);
  assert.equal((await db.collection('market_v7').doc('lot-corrupt-price').get()).exists, true);
  assert.equal((await db.collection('players_v14').doc('buyer-1').get()).get('credits'), 700);
  assert.equal((await db.collection('players_v14').doc('seller-1').get()).get('credits'), 200);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});


test('Firestore Emulator standard transfer-market bids reserve, refund and settle credits exactly once', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('standard-seller').set({
    credits: 100,
    ownedPlayers: [{ id: 'standard-player', name: 'Standard Player', onTransferUntil: new Date(now + 60 * 60 * 1000).toISOString(), transferMarketId: 'standard-flow' }],
  });
  await db.collection('players_v14').doc('standard-bidder-1').set({ credits: 1000, displayName: 'First', ownedPlayers: [] });
  await db.collection('players_v14').doc('standard-bidder-2').set({ credits: 1000, displayName: 'Second', ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('standard-flow');
  await lotRef.set({
    sellerId: 'standard-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'standard-player', name: 'Standard Player' },
    isPro: false,
    isYouth: false,
  });

  await placeStandardMarketBidWithDb(db, 'standard-bidder-1', 'standard-flow', 300);
  await placeStandardMarketBidWithDb(db, 'standard-bidder-2', 'standard-flow', 400);
  await placeStandardMarketBidWithDb(db, 'standard-bidder-2', 'standard-flow', 500);

  assert.equal((await db.collection('players_v14').doc('standard-bidder-1').get()).get('credits'), 1000);
  assert.equal((await db.collection('players_v14').doc('standard-bidder-2').get()).get('credits'), 500);
  const activeLot = await lotRef.get();
  assert.equal(activeLot.get('highestBidderId'), 'standard-bidder-2');
  assert.equal(activeLot.get('currentBid'), 500);
  assert.equal(activeLot.get('escrowedAmount'), 500);
  assert.equal(activeLot.get('escrowCurrency'), 'credits');
  assert.ok(activeLot.get('bidders').includes('standard-bidder-2'));

  const bidLedger = await db.collection('economy_transactions').where('referenceId', '==', 'standard-flow').get();
  const bidRows = bidLedger.docs.map(doc => doc.data());
  assert.equal(bidRows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 800);
  assert.equal(bidRows.filter(row => row.type === 'SPECIAL_AUCTION_OUTBID_REFUND').reduce((sum, row) => sum + row.amount, 0), 300);

  await lotRef.update({ expiresAt: new Date(now - 1).toISOString() });
  const settlementRuns = await Promise.all([
    runTransferMarketExpirySweepWithDb(db),
    runTransferMarketExpirySweepWithDb(db),
  ]);
  // A concurrent worker may legitimately observe the active sweep lease and
  // return a retryable busy no-op. Only the winning worker must settle the lot.
  assert.ok(settlementRuns.every(result => result.success || result.busy === true), JSON.stringify(settlementRuns));
  assert.ok(settlementRuns.every(result => !result.busy ||
    result.errors?.some(error => error.error === 'MARKET_EXPIRY_SWEEP_BUSY')), JSON.stringify(settlementRuns));
  assert.equal(settlementRuns.reduce((sum, result) => sum + result.sold, 0), 1);
  assert.equal(settlementRuns.reduce((sum, result) => sum + result.settled, 0), 1);
  assert.equal((await lotRef.get()).exists, false);

  const seller = await db.collection('players_v14').doc('standard-seller').get();
  const firstBidder = await db.collection('players_v14').doc('standard-bidder-1').get();
  const winner = await db.collection('players_v14').doc('standard-bidder-2').get();
  assert.equal(seller.get('credits'), 575, 'seller receives 500 less the 5% commission');
  assert.equal(firstBidder.get('credits'), 1000, 'outbid manager receives the full refund');
  assert.equal(winner.get('credits'), 500, 'settlement must not charge the escrowed winner twice');
  assert.deepEqual(seller.get('ownedPlayers'), []);
  assert.deepEqual(winner.get('ownedPlayers').map(player => player.id), ['standard-player']);

  const finalLedger = await db.collection('economy_transactions').where('referenceId', '==', 'standard-flow').get();
  const rows = finalLedger.docs.map(doc => doc.data());
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 800);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_OUTBID_REFUND').reduce((sum, row) => sum + row.amount, 0), 300);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_SETTLEMENT_CREDIT').reduce((sum, row) => sum + row.amount, 0), 475);
  assert.equal((await db.collection('transfer_history').get()).size, 1);
});


test('Firestore Emulator standard transfer-market concurrent bids serialize without double-charging', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('standard-race-seller').set({
    credits: 0,
    ownedPlayers: [{ id: 'standard-race-player', name: 'Race Player', onTransferUntil: new Date(now + 60 * 60 * 1000).toISOString(), transferMarketId: 'standard-race' }],
  });
  await db.collection('players_v14').doc('standard-race-bidder').set({ credits: 1000, displayName: 'Race Bidder' });
  const lotRef = db.collection('market_v7').doc('standard-race');
  await lotRef.set({
    sellerId: 'standard-race-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'standard-race-player', name: 'Race Player' },
    isPro: false,
    isYouth: false,
  });

  const outcomes = await Promise.allSettled([
    placeStandardMarketBidWithDb(db, 'standard-race-bidder', 'standard-race', 300),
    placeStandardMarketBidWithDb(db, 'standard-race-bidder', 'standard-race', 400),
  ]);
  assert.ok(outcomes.some(result => result.status === 'fulfilled'));
  const rejected = outcomes.find(result => result.status === 'rejected');
  if (rejected) assert.match(String(rejected.reason?.message || ''), /BID_TOO_LOW/);

  const bidder = await db.collection('players_v14').doc('standard-race-bidder').get();
  const lot = await lotRef.get();
  assert.equal(bidder.get('credits'), 600);
  assert.equal(lot.get('highestBidderId'), 'standard-race-bidder');
  assert.equal(lot.get('currentBid'), 400);
  assert.equal(lot.get('escrowedAmount'), 400);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'standard-race').get();
  const rows = ledger.docs.map(doc => doc.data());
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_BID_ESCROW').reduce((sum, row) => sum - row.amount, 0), 400);
  assert.equal(rows.filter(row => row.type === 'SPECIAL_AUCTION_OUTBID_REFUND').length, 0);
});

test('Firestore Emulator standard transfer-market insufficient funds leave no partial writes', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('standard-poor-seller').set({
    credits: 0,
    ownedPlayers: [{ id: 'standard-poor-player', name: 'Poor Bidder Player', onTransferUntil: new Date(now + 60 * 60 * 1000).toISOString(), transferMarketId: 'standard-poor-lot' }],
  });
  await db.collection('players_v14').doc('standard-poor-bidder').set({ credits: 250 });
  const lotRef = db.collection('market_v7').doc('standard-poor-lot');
  await lotRef.set({
    sellerId: 'standard-poor-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'standard-poor-player', name: 'Poor Bidder Player' },
    isPro: false,
    isYouth: false,
  });

  await assert.rejects(
    placeStandardMarketBidWithDb(db, 'standard-poor-bidder', 'standard-poor-lot', 300),
    /INSUFFICIENT_FUNDS/,
  );
  assert.equal((await db.collection('players_v14').doc('standard-poor-bidder').get()).get('credits'), 250);
  const lot = await lotRef.get();
  assert.equal(lot.get('highestBidderId'), null);
  assert.equal(lot.get('currentBid'), 200);
  assert.equal(lot.get('escrowedAmount'), undefined);
  assert.deepEqual(lot.get('bidders'), []);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
});


test('Firestore Emulator settles legacy listings without escrow by charging the winner exactly once', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('legacy-seller').set({
    credits: 50,
    ownedPlayers: [{ id: 'legacy-player', name: 'Legacy Player', onTransferUntil: 'reserved', transferMarketId: 'legacy-no-escrow' }],
  });
  await db.collection('players_v14').doc('legacy-buyer').set({ credits: 1000, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('legacy-no-escrow');
  await lotRef.set({
    sellerId: 'legacy-seller',
    highestBidderUid: 'legacy-buyer',
    currentBid: 400,
    startingPrice: 200,
    currency: 'credits',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    heroData: { id: 'legacy-player', name: 'Legacy Player' },
    isYouth: false,
  });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 1);
  assert.equal((await lotRef.get()).exists, false);
  assert.equal((await db.collection('players_v14').doc('legacy-buyer').get()).get('credits'), 600);
  assert.equal((await db.collection('players_v14').doc('legacy-seller').get()).get('credits'), 430);
  assert.deepEqual((await db.collection('players_v14').doc('legacy-seller').get()).get('ownedPlayers'), []);
  assert.deepEqual(
    (await db.collection('players_v14').doc('legacy-buyer').get()).get('ownedPlayers').map(player => player.id),
    ['legacy-player'],
  );
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'legacy-no-escrow').get();
  assert.equal(ledger.docs.filter(doc => doc.get('type') === 'SPECIAL_AUCTION_SETTLEMENT_DEBIT').length, 1);
  assert.equal(ledger.docs.filter(doc => doc.get('type') === 'SPECIAL_AUCTION_SETTLEMENT_CREDIT').length, 1);
  assert.equal((await db.collection('transfer_history').get()).size, 1);
});

test('Firestore Emulator refunds escrow when the seller account has disappeared', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('legacy-buyer').set({ credits: 600, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('missing-seller');
  await lotRef.set(expiredLot({
    sellerId: 'deleted-seller',
    highestBidderId: null,
    highestBidderUid: 'legacy-buyer',
    currentBid: 400,
    escrowedAmount: 400,
    heroData: { id: 'unavailable-player', name: 'Unavailable Player' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await db.collection('players_v14').doc('legacy-buyer').get()).get('credits'), 1000);
  assert.equal((await lotRef.get()).exists, false);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'missing-seller').get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_REFUND');
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});


test('Firestore Emulator expires a legacy no-escrow lot without charging a winner who cannot afford it', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('legacy-poor-seller').set({
    credits: 20,
    ownedPlayers: [{ id: 'legacy-poor-player', name: 'Legacy Poor Player', onTransferUntil: 'reserved', transferMarketId: 'legacy-poor-lot' }],
  });
  await db.collection('players_v14').doc('legacy-poor-buyer').set({ credits: 100, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('legacy-poor-lot');
  await lotRef.set({
    sellerId: 'legacy-poor-seller',
    highestBidderUid: 'legacy-poor-buyer',
    currentBid: 400,
    startingPrice: 200,
    currency: 'credits',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    heroData: { id: 'legacy-poor-player', name: 'Legacy Poor Player' },
  });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await db.collection('players_v14').doc('legacy-poor-buyer').get()).get('credits'), 100);
  const seller = await db.collection('players_v14').doc('legacy-poor-seller').get();
  assert.equal(seller.get('credits'), 20);
  assert.equal(seller.get('ownedPlayers')[0].onTransferUntil, null);
  assert.equal((await lotRef.get()).exists, false);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});

test('Firestore Emulator refunds a valid escrow when the buyer already owns the listed player', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('duplicate-owner-seller').set({
    credits: 10,
    ownedPlayers: [{ id: 'duplicate-player', name: 'Duplicate Player', onTransferUntil: 'reserved', transferMarketId: 'duplicate-owner-lot' }],
  });
  await db.collection('players_v14').doc('duplicate-owner-buyer').set({
    credits: 500,
    ownedPlayers: [{ id: 'duplicate-player', name: 'Duplicate Player' }],
  });
  const lotRef = db.collection('market_v7').doc('duplicate-owner-lot');
  await lotRef.set(expiredLot({
    sellerId: 'duplicate-owner-seller',
    highestBidderId: 'duplicate-owner-buyer',
    currentBid: 400,
    startingPrice: 200,
    escrowedAmount: 400,
    heroData: { id: 'duplicate-player', name: 'Duplicate Player' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await db.collection('players_v14').doc('duplicate-owner-buyer').get()).get('credits'), 900);
  const seller = await db.collection('players_v14').doc('duplicate-owner-seller').get();
  assert.equal(seller.get('credits'), 10);
  assert.equal(seller.get('ownedPlayers')[0].onTransferUntil, null);
  assert.equal((await lotRef.get()).exists, false);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', 'duplicate-owner-lot').get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_REFUND');
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});


test('Firestore Emulator refunds a malformed self-bid and unlocks the seller player without transferring it', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const sellerId = 'self-bidding-seller';
  const lotId = 'legacy-self-bid-lot';
  await db.collection('players_v14').doc(sellerId).set({
    credits: 100,
    ownedPlayers: [{
      id: 'self-bid-player',
      name: 'Locked Player',
      onTransferUntil: 'reserved',
      transferMarketId: lotId,
    }],
  });
  const lotRef = db.collection('market_v7').doc(lotId);
  await lotRef.set(expiredLot({
    sellerId,
    highestBidderId: sellerId,
    currentBid: 300,
    startingPrice: 200,
    escrowCurrency: 'credits',
    escrowedAmount: 300,
    heroData: { id: 'self-bid-player', name: 'Locked Player' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 0);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await lotRef.get()).exists, false);

  const seller = await db.collection('players_v14').doc(sellerId).get();
  assert.equal(seller.get('credits'), 400, 'the malformed self-bid escrow is returned exactly once');
  assert.deepEqual(seller.get('ownedPlayers'), [{
    id: 'self-bid-player',
    name: 'Locked Player',
    onTransferUntil: null,
    transferMarketId: null,
  }]);
  const refund = await db.collection('economy_transactions').where('referenceId', '==', lotId).get();
  assert.equal(refund.size, 1);
  assert.equal(refund.docs[0].get('amount'), 300);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});


test('Firestore Emulator rejects malformed fractional auction balances without partial bid or refund writes', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  await db.collection('players_v14').doc('fractional-bidder').set({ credits: 1000.5, ownedPlayers: [] });
  await db.collection('players_v14').doc('fractional-seller').set({
    credits: 20,
    ownedPlayers: [{ id: 'fractional-player', name: 'Fractional Player', onTransferUntil: new Date(now + 60 * 60 * 1000).toISOString(), transferMarketId: 'fractional-bid' }],
  });
  const bidLot = db.collection('market_v7').doc('fractional-bid');
  await bidLot.set({
    sellerId: 'fractional-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    heroData: { id: 'fractional-player', name: 'Fractional Player' },
    isPro: false,
    isYouth: false,
  });

  await assert.rejects(
    placeStandardMarketBidWithDb(db, 'fractional-bidder', 'fractional-bid', 300),
    /AUCTION_BALANCE_INVALID/,
  );
  assert.equal((await db.collection('players_v14').doc('fractional-bidder').get()).get('credits'), 1000.5);
  assert.equal((await bidLot.get()).get('highestBidderId'), null);

  const refundLot = db.collection('market_v7').doc('fractional-refund');
  await refundLot.set(expiredLot({
    sellerId: 'fractional-seller',
    highestBidderId: 'fractional-bidder',
    currentBid: 300,
    startingPrice: 200,
    escrowCurrency: 'credits',
    escrowedAmount: 300,
    heroData: { id: 'missing-player', name: 'Missing Player' },
  }));
  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, false);
  assert.ok(result.errors.some(error => error.id === 'fractional-refund' && /AUCTION_BALANCE_INVALID/.test(error.error)));
  assert.equal((await refundLot.get()).exists, true);
  assert.equal((await db.collection('players_v14').doc('fractional-bidder').get()).get('credits'), 1000.5);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
});

test('Firestore Emulator preserves escrow and lots when seller or buyer rosters are malformed', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('duplicate-roster-seller').set({
    credits: 25,
    ownedPlayers: [
      { id: 'duplicate-roster-player', name: 'Duplicate Player', onTransferUntil: 'reserved', transferMarketId: 'duplicate-roster-lot' },
      { id: 'duplicate-roster-player', name: 'Duplicate Player Copy', onTransferUntil: 'reserved', transferMarketId: 'duplicate-roster-lot' },
    ],
  });
  await db.collection('players_v14').doc('duplicate-roster-buyer').set({
    credits: 600,
    ownedPlayers: [],
  });
  await db.collection('market_v7').doc('duplicate-roster-lot').set(expiredLot({
    sellerId: 'duplicate-roster-seller',
    highestBidderId: 'duplicate-roster-buyer',
    currentBid: 400,
    escrowedAmount: 400,
    heroData: { id: 'duplicate-roster-player', name: 'Duplicate Player' },
  }));

  await db.collection('players_v14').doc('malformed-roster-seller').set({
    credits: 25,
    ownedPlayers: [{ id: 'malformed-roster-player', name: 'Malformed Roster Player' }],
  });
  await db.collection('players_v14').doc('malformed-roster-buyer').set({
    credits: 600,
    ownedPlayers: { corrupted: true },
  });
  await db.collection('market_v7').doc('malformed-roster-lot').set(expiredLot({
    sellerId: 'malformed-roster-seller',
    highestBidderId: 'malformed-roster-buyer',
    currentBid: 400,
    escrowedAmount: 400,
    heroData: { id: 'malformed-roster-player', name: 'Malformed Roster Player' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, false);
  assert.ok(result.errors.some(error => error.id === 'duplicate-roster-lot' && /AUCTION_SELLER_PLAYER_DUPLICATE/.test(error.error)));
  assert.ok(result.errors.some(error => error.id === 'malformed-roster-lot' && /AUCTION_BUYER_ROSTER_INVALID/.test(error.error)));

  for (const lotId of ['duplicate-roster-lot', 'malformed-roster-lot']) {
    assert.equal((await db.collection('market_v7').doc(lotId).get()).exists, true);
  }
  assert.equal((await db.collection('players_v14').doc('duplicate-roster-buyer').get()).get('credits'), 600);
  assert.equal((await db.collection('players_v14').doc('malformed-roster-buyer').get()).get('credits'), 600);
  assert.equal((await db.collection('players_v14').doc('duplicate-roster-seller').get()).get('credits'), 25);
  assert.equal((await db.collection('players_v14').doc('malformed-roster-seller').get()).get('credits'), 25);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});

test('Firestore Emulator rejects bids on explicitly settled or expired lots without changing escrow or balances', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (const status of ['settled', 'expired']) {
    const standardLotId = `terminal-standard-${status}`;
    const specialLotId = `terminal-pro-${status}`;
    await db.collection('players_v14').doc(`standard-buyer-${status}`).set({ credits: 1000 });
    await db.collection('players_v14').doc(`pro-buyer-${status}`).set({ crystals: 1000 });
    await db.collection('market_v7').doc(standardLotId).set({
      status, sellerId: 'seller', currency: 'credits', currentBid: 100, startingPrice: 100,
      highestBidderId: null, expiresAt,
    });
    await db.collection('market_v7').doc(specialLotId).set({
      status, sellerId: 'seller', isPro: true, currency: 'crystals', currentBid: 100,
      startingPrice: 100, highestBidderId: null, expiresAt,
    });

    await assert.rejects(
      placeStandardMarketBidWithDb(db, `standard-buyer-${status}`, standardLotId, 103),
      /MARKET_LOT_NOT_ACTIVE/,
    );
    await assert.rejects(
      placeSpecialMarketBidWithDb(db, `pro-buyer-${status}`, specialLotId, 103, 'pro'),
      /MARKET_LOT_NOT_ACTIVE/,
    );

    assert.equal((await db.collection('players_v14').doc(`standard-buyer-${status}`).get()).get('credits'), 1000);
    assert.equal((await db.collection('players_v14').doc(`pro-buyer-${status}`).get()).get('crystals'), 1000);
    assert.equal((await db.collection('market_v7').doc(standardLotId).get()).get('status'), status);
    assert.equal((await db.collection('market_v7').doc(specialLotId).get()).get('status'), status);
    assert.equal((await db.collection('economy_transactions').where('referenceId', 'in', [standardLotId, specialLotId]).get()).size, 0);
  }
});

test('Firestore Emulator processes expired auction lots page-by-page beyond the 200-document scan boundary', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const firestore = db.collection('market_v7').firestore;
  const batch = firestore.batch();
  const now = new Date(Date.now() - 60_000).toISOString();
  const lotIds = Array.from({ length: 205 }, (_, index) => `page-lot-${String(index).padStart(3, '0')}`);

  for (const id of lotIds) {
    batch.set(db.collection('market_v7').doc(id), {
      sellerId: '',
      highestBidderId: null,
      currentBid: 0,
      startingPrice: 0,
      currency: 'credits',
      escrowedAmount: 0,
      expiresAt: now,
      heroData: { id: `player-${id}`, name: 'Expired Player' },
      isYouth: false,
    });
  }
  await batch.commit();

  const firstRun = await runTransferMarketExpirySweepWithDb(db, { maxPages: 1 });
  assert.equal(firstRun.success, true);
  assert.equal(firstRun.complete, false);
  assert.equal(firstRun.continuation, true);
  assert.equal(firstRun.scanned, 200);
  assert.equal(firstRun.settled, 200);
  assert.equal((await db.collection('market_v7').get()).size, 5);
  const checkpoint = await db.collection('system_jobs_v1').doc('market_expiry_sweep').get();
  assert.equal(checkpoint.get('cursorId'), 'page-lot-199');
  assert.equal(checkpoint.get('leaseOwner'), null);

  const secondRun = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(secondRun.success, true);
  assert.equal(secondRun.complete, true);
  assert.equal(secondRun.continuation, false);
  assert.equal(secondRun.scanned, 5);
  assert.equal(secondRun.due, 5);
  assert.equal(secondRun.settled, 5);
  assert.equal(secondRun.expiredWithoutSale, 5);
  assert.equal((await db.collection('market_v7').get()).size, 0);
  assert.equal((await checkpoint.ref.get()).get('cursorId'), null);
});

test('Firestore Emulator prevents overlapping market expiry sweeps with an active lease', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const lotRef = db.collection('market_v7').doc('lease-protected-lot');
  await lotRef.set(expiredLot({ sellerId: '', highestBidderId: null }));
  await db.collection('system_jobs_v1').doc('market_expiry_sweep').set({
    leaseOwner: 'another-worker',
    leaseUntilMs: Date.now() + 60_000,
    cursorId: null,
  });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, false);
  assert.equal(result.busy, true);
  assert.ok(result.errors.some(error => error.error === 'MARKET_EXPIRY_SWEEP_BUSY'));
  assert.equal((await lotRef.get()).exists, true);
});


test('Firestore Emulator keeps a player reserved by a newer listing when an older expired lot settles', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const sellerRef = db.collection('players_v14').doc('seller-1');
  const buyerRef = db.collection('players_v14').doc('buyer-1');
  const newerExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await sellerRef.set({
    credits: 25,
    ownedPlayers: [{
      id: 'hero-1',
      name: 'Relisted Hero',
      onTransferUntil: newerExpiry,
      transferMarketId: 'newer-active-lot',
    }],
  });
  await buyerRef.set({ credits: 0, ownedPlayers: [] });
  const staleLotRef = db.collection('market_v7').doc('older-expired-lot');
  await staleLotRef.set(expiredLot({
    sellerId: 'seller-1',
    highestBidderId: 'buyer-1',
    currentBid: 1000,
    startingPrice: 500,
    escrowCurrency: 'credits',
    escrowedAmount: 1000,
    heroData: { id: 'hero-1', name: 'Relisted Hero' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 0);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await staleLotRef.get()).exists, false);

  const seller = await sellerRef.get();
  const sellerPlayers = seller.get('ownedPlayers');
  assert.equal(seller.get('credits'), 25, 'the stale lot must not credit the seller');
  assert.equal(sellerPlayers.length, 1);
  assert.equal(sellerPlayers[0].transferMarketId, 'newer-active-lot');
  assert.equal(sellerPlayers[0].onTransferUntil, newerExpiry);
  assert.equal((await buyerRef.get()).get('credits'), 1000, 'the stale lot escrow is refunded exactly once');
  assert.equal((await db.collection('transfer_history').get()).size, 0);
  const refunds = await db.collection('economy_transactions').where('referenceId', '==', 'older-expired-lot').get();
  assert.equal(refunds.size, 1);
  assert.equal(refunds.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_REFUND');
});


test('Firestore Emulator rejects bids against a stale lot after the seller relists the player', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const lockUntil = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('relisted-seller').set({
    credits: 0,
    ownedPlayers: [{
      id: 'relisted-player',
      name: 'Relisted Player',
      onTransferUntil: lockUntil,
      transferMarketId: 'newer-active-listing',
    }],
  });
  await db.collection('players_v14').doc('stale-bidder').set({ credits: 1000, ownedPlayers: [] });
  const staleLot = db.collection('market_v7').doc('older-listing');
  await staleLot.set({
    sellerId: 'relisted-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: lockUntil,
    heroData: { id: 'relisted-player', name: 'Relisted Player' },
    isPro: false,
    isYouth: false,
  });

  await assert.rejects(
    placeStandardMarketBidWithDb(db, 'stale-bidder', 'older-listing', 300),
    /MARKET_LOT_STALE/,
  );
  assert.equal((await db.collection('players_v14').doc('stale-bidder').get()).get('credits'), 1000);
  assert.equal((await staleLot.get()).get('highestBidderId'), null);
  assert.equal((await staleLot.get()).get('currentBid'), 200);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
});


test('Firestore Emulator extends the seller reservation together with an anti-sniping lot extension', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const initialExpiry = new Date(now + 5 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('anti-snipe-seller').set({
    credits: 0,
    ownedPlayers: [{
      id: 'anti-snipe-player',
      name: 'Anti Snipe Player',
      onTransferUntil: initialExpiry,
      transferMarketId: 'anti-snipe-lot',
    }],
  });
  await db.collection('players_v14').doc('anti-snipe-bidder').set({ credits: 1000, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('anti-snipe-lot');
  await lotRef.set({
    sellerId: 'anti-snipe-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 200,
    startingPrice: 200,
    highestBidderId: null,
    bidders: [],
    expiresAt: initialExpiry,
    heroData: { id: 'anti-snipe-player', name: 'Anti Snipe Player' },
    isPro: false,
    isYouth: false,
  });

  await placeStandardMarketBidWithDb(db, 'anti-snipe-bidder', 'anti-snipe-lot', 300);
  const [lot, seller] = await Promise.all([
    lotRef.get(),
    db.collection('players_v14').doc('anti-snipe-seller').get(),
  ]);
  const sellerPlayer = seller.get('ownedPlayers')[0];
  assert.ok(Date.parse(lot.get('expiresAt')) > Date.parse(initialExpiry));
  assert.equal(sellerPlayer.onTransferUntil, lot.get('expiresAt'));
  assert.equal(sellerPlayer.transferMarketId, 'anti-snipe-lot');
});

test('Firestore Emulator extends the Youth seller reservation with an anti-sniping lot extension', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const initialExpiry = new Date(now + 5 * 60 * 1000).toISOString();
  const extendedExpiry = new Date(now + 10 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('youth-seller').set({
    credits: 0,
    youthAcademyPlayers: [{
      id: 'youth-player',
      name: 'Youth Player',
      onTransferUntil: initialExpiry,
      transferMarketId: 'youth-anti-snipe',
    }],
  });
  await db.collection('players_v14').doc('youth-buyer').set({ credits: 500, youthAcademyPlayers: [] });
  const lotRef = db.collection('market_v7').doc('youth-anti-snipe');
  await lotRef.set({
    sellerId: 'youth-seller', isYouth: true, currency: 'credits',
    currentBid: 100, startingPrice: 100, highestBidderId: null, bidders: [],
    expiresAt: initialExpiry, heroData: { id: 'youth-player', name: 'Youth Player' },
  });

  await placeSpecialMarketBidWithDb(db, 'youth-buyer', 'youth-anti-snipe', 250, 'youth', now);
  assert.equal((await lotRef.get()).get('expiresAt'), extendedExpiry);
  const sellerAfterBid = await db.collection('players_v14').doc('youth-seller').get();
  assert.equal(sellerAfterBid.get('youthAcademyPlayers')[0].onTransferUntil, extendedExpiry);

  await lotRef.update({ expiresAt: new Date(now - 1).toISOString() });
  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 1);
  assert.deepEqual((await db.collection('players_v14').doc('youth-buyer').get()).get('youthAcademyPlayers').map(player => player.id), ['youth-player']);
  assert.deepEqual((await db.collection('players_v14').doc('youth-seller').get()).get('youthAcademyPlayers'), []);
});

test('Firestore Emulator rejects a Youth bid against a stale seller reservation before charging escrow', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('youth-seller').set({
    credits: 0,
    youthAcademyPlayers: [{
      id: 'youth-player',
      onTransferUntil: expiresAt,
      transferMarketId: 'different-lot',
    }],
  });
  await db.collection('players_v14').doc('youth-buyer').set({ credits: 500 });
  await db.collection('market_v7').doc('stale-youth-lot').set({
    sellerId: 'youth-seller', isYouth: true, currency: 'credits',
    currentBid: 100, startingPrice: 100, highestBidderId: null,
    expiresAt, heroData: { id: 'youth-player' },
  });

  await assert.rejects(
    placeSpecialMarketBidWithDb(db, 'youth-buyer', 'stale-youth-lot', 250, 'youth', now),
    /MARKET_LOT_STALE/,
  );
  assert.equal((await db.collection('players_v14').doc('youth-buyer').get()).get('credits'), 500);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('market_v7').doc('stale-youth-lot').get()).get('highestBidderId'), null);
});

test('Firestore Emulator refunds escrow and unlocks a Youth player when its reservation expires before the lot', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const lotExpiry = new Date(now - 60 * 1000).toISOString();
  const shorterLock = new Date(now - 120 * 1000).toISOString();
  await db.collection('players_v14').doc('youth-seller').set({
    credits: 0,
    youthAcademyPlayers: [{
      id: 'youth-player',
      onTransferUntil: shorterLock,
      transferMarketId: 'short-youth-lock',
    }],
  });
  await db.collection('players_v14').doc('youth-buyer').set({
    credits: 250,
    youthAcademyPlayers: [],
  });
  const lotRef = db.collection('market_v7').doc('short-youth-lock');
  await lotRef.set({
    sellerId: 'youth-seller', isYouth: true, currency: 'credits',
    currentBid: 250, startingPrice: 100, highestBidderId: 'youth-buyer',
    escrowCurrency: 'credits', escrowedAmount: 250,
    expiresAt: lotExpiry, heroData: { id: 'youth-player', name: 'Youth Player' },
  });

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 0);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await lotRef.get()).exists, false);
  const seller = await db.collection('players_v14').doc('youth-seller').get();
  assert.equal(seller.get('youthAcademyPlayers')[0].transferMarketId, null);
  assert.equal(seller.get('youthAcademyPlayers')[0].onTransferUntil, null);
  const buyer = await db.collection('players_v14').doc('youth-buyer').get();
  assert.equal(buyer.get('credits'), 500);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
  assert.equal((await db.collection('economy_transactions').where('referenceId', '==', 'short-youth-lock').get()).size, 1);
});


test('Firestore Emulator creates distinct standard listing IDs for same-millisecond concurrent listings and atomically reserves both players', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = 1_800_000_000_000;
  await db.collection('players_v14').doc('listing-seller').set({
    displayName: 'Listing Seller',
    ownedPlayers: [
      { id: 'standard-player-a', name: 'Standard A', overallRating: 60, proStats: {} },
      { id: 'standard-player-b', name: 'Standard B', overallRating: 70, proStats: {} },
    ],
  });

  const [first, second] = await Promise.all([
    createStandardMarketListingWithDb(db, 'listing-seller', 'standard-player-a', now),
    createStandardMarketListingWithDb(db, 'listing-seller', 'standard-player-b', now),
  ]);
  assert.notEqual(first.agentId, second.agentId);
  const [firstLot, secondLot, seller] = await Promise.all([
    db.collection('market_v7').doc(first.agentId).get(),
    db.collection('market_v7').doc(second.agentId).get(),
    db.collection('players_v14').doc('listing-seller').get(),
  ]);
  assert.equal(firstLot.exists, true);
  assert.equal(secondLot.exists, true);
  assert.equal(firstLot.get('sellerId'), 'listing-seller');
  assert.equal(secondLot.get('sellerId'), 'listing-seller');
  assert.equal(firstLot.get('currency'), 'credits');
  assert.equal(secondLot.get('currency'), 'credits');
  assert.ok(Number.isSafeInteger(firstLot.get('currentBid')) && firstLot.get('currentBid') > 0);
  assert.ok(Number.isSafeInteger(secondLot.get('currentBid')) && secondLot.get('currentBid') > 0);

  const players = seller.get('ownedPlayers');
  const firstPlayer = players.find(player => player.id === 'standard-player-a');
  const secondPlayer = players.find(player => player.id === 'standard-player-b');
  assert.equal(firstPlayer.transferMarketId, first.agentId);
  assert.equal(secondPlayer.transferMarketId, second.agentId);
  assert.equal(firstPlayer.onTransferUntil, first.expiresAt);
  assert.equal(secondPlayer.onTransferUntil, second.expiresAt);
});

test('Firestore Emulator rejects duplicate standard ownership and malformed market prices before writes', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = 1_800_000_000_000;
  await db.collection('players_v14').doc('ambiguous-seller').set({
    ownedPlayers: [
      { id: 'duplicate-player', overallRating: 50, proStats: {} },
      { id: 'duplicate-player', overallRating: 60, proStats: {} },
      { id: 'malformed-price-player', overallRating: 'corrupt', proStats: {} },
    ],
  });

  await assert.rejects(
    createStandardMarketListingWithDb(db, 'ambiguous-seller', 'duplicate-player', now),
    /PLAYER_OWNERSHIP_AMBIGUOUS/,
  );
  await assert.rejects(
    createStandardMarketListingWithDb(db, 'ambiguous-seller', 'malformed-price-player', now),
    /MARKET_PRICE_INVALID/,
  );
  assert.equal((await db.collection('market_v7').get()).size, 0);
  const seller = await db.collection('players_v14').doc('ambiguous-seller').get();
  assert.equal(seller.get('ownedPlayers').every(player => !player.transferMarketId), true);
});

test('Firestore Emulator creates distinct Youth listing IDs for same-millisecond concurrent listings and validates rating before writes', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = 1_800_000_000_000;
  await db.collection('players_v14').doc('youth-listing-seller').set({
    displayName: 'Youth Seller',
    youthAcademyPlayers: [
      { id: 'youth-player-a', name: 'Youth A', overallRating: 55 },
      { id: 'youth-player-b', name: 'Youth B', overallRating: 65 },
      { id: 'youth-player-invalid', name: 'Invalid Youth', overallRating: 101 },
    ],
  });

  const [first, second] = await Promise.all([
    createYouthMarketListingWithDb(db, 'youth-listing-seller', 'youth-player-a', now),
    createYouthMarketListingWithDb(db, 'youth-listing-seller', 'youth-player-b', now),
  ]);
  assert.notEqual(first.marketId, second.marketId);
  const [firstLot, secondLot, seller] = await Promise.all([
    db.collection('market_v7').doc(first.marketId).get(),
    db.collection('market_v7').doc(second.marketId).get(),
    db.collection('players_v14').doc('youth-listing-seller').get(),
  ]);
  assert.equal(firstLot.exists, true);
  assert.equal(secondLot.exists, true);
  assert.equal(firstLot.get('currentBid'), 300000);
  assert.equal(secondLot.get('currentBid'), 350000);
  const players = seller.get('youthAcademyPlayers');
  assert.equal(players.find(player => player.id === 'youth-player-a').transferMarketId, first.marketId);
  assert.equal(players.find(player => player.id === 'youth-player-b').transferMarketId, second.marketId);

  await assert.rejects(
    createYouthMarketListingWithDb(db, 'youth-listing-seller', 'youth-player-invalid', now),
    /MARKET_PRICE_INVALID/,
  );
  assert.equal((await db.collection('market_v7').get()).size, 2);
  const afterInvalid = await db.collection('players_v14').doc('youth-listing-seller').get();
  assert.equal(afterInvalid.get('youthAcademyPlayers').find(player => player.id === 'youth-player-invalid').transferMarketId, undefined);
});

test('Firestore Emulator rejects standard bids when a legacy lot records the seller as its highest bidder', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('self-bid-seller').set({
    credits: 700,
    ownedPlayers: [{
      id: 'self-bid-player',
      name: 'Self Bid Player',
      onTransferUntil: expiresAt,
      transferMarketId: 'self-bid-lot',
    }],
  });
  await db.collection('players_v14').doc('self-bid-buyer').set({
    credits: 1000,
    ownedPlayers: [],
  });
  const lotRef = db.collection('market_v7').doc('self-bid-lot');
  await lotRef.set({
    sellerId: 'self-bid-seller',
    marketType: 'player',
    currency: 'credits',
    currentBid: 300,
    startingPrice: 200,
    highestBidderId: 'self-bid-seller',
    highestBidderName: 'Seller',
    bidders: ['self-bid-seller'],
    escrowedAmount: 300,
    escrowCurrency: 'credits',
    expiresAt,
    heroData: { id: 'self-bid-player', name: 'Self Bid Player' },
    isPro: false,
    isYouth: false,
  });

  await assert.rejects(
    placeStandardMarketBidWithDb(db, 'self-bid-buyer', 'self-bid-lot', 400),
    /MARKET_PREVIOUS_BIDDER_INVALID/,
  );

  const seller = await db.collection('players_v14').doc('self-bid-seller').get();
  const buyer = await db.collection('players_v14').doc('self-bid-buyer').get();
  const lot = await lotRef.get();
  assert.equal(seller.get('credits'), 700, 'rejected bids must not refund the legacy seller escrow');
  assert.equal(buyer.get('credits'), 1000, 'rejected bids must not charge the new bidder');
  assert.equal(lot.get('highestBidderId'), 'self-bid-seller');
  assert.equal(lot.get('currentBid'), 300);
  assert.equal(lot.get('escrowedAmount'), 300);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
});


test('auction identity resolution falls back from blank canonical bidder IDs to legacy UID aliases', () => {
  assert.equal(normalizeAuctionUserId(' seller-1 '), 'seller-1');
  assert.equal(normalizeAuctionUserId('   '), '');
  assert.equal(resolveAuctionBidderId({ highestBidderId: '   ', highestBidderUid: 'buyer-1' }), 'buyer-1');
  assert.equal(resolveAuctionBidderId({ highestBidderId: ' buyer-2 ', highestBidderUid: 'buyer-1' }), 'buyer-2');
  assert.equal(resolveAuctionBidderId({ highestBidderId: '  ', highestBidderUid: '  ' }), '');
});

test('system auction rotation never prunes a lot with a bidder hidden behind a blank canonical ID', () => {
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderId: '  ', highestBidderUid: 'buyer-1', escrowedAmount: 0 }), false);
  assert.equal(canPruneUnbidSystemAuctionLot({ highestBidderId: '  ', highestBidderUid: '  ', escrowedAmount: 0 }), true);
});


test('Firestore Emulator resolves legacy bidder UID aliases when accepting standard, PRO and Youth outbids', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();

  await db.collection('players_v14').doc('standard-seller').set({
    credits: 0,
    ownedPlayers: [{ id: 'standard-legacy-player', name: 'Standard Legacy Player', onTransferUntil: expiresAt, transferMarketId: 'standard-legacy-alias' }],
  });
  await db.collection('players_v14').doc('standard-previous').set({ credits: 700, ownedPlayers: [] });
  await db.collection('players_v14').doc('standard-buyer').set({ credits: 1000, ownedPlayers: [] });
  await db.collection('market_v7').doc('standard-legacy-alias').set({
    sellerId: 'standard-seller', marketType: 'player', currency: 'credits',
    currentBid: 200, startingPrice: 100, highestBidderId: '   ', highestBidderUid: 'standard-previous',
    escrowCurrency: 'credits', escrowedAmount: 200, expiresAt,
    heroData: { id: 'standard-legacy-player', name: 'Standard Legacy Player' }, isPro: false, isYouth: false,
  });
  await placeStandardMarketBidWithDb(db, 'standard-buyer', 'standard-legacy-alias', 300);
  assert.equal((await db.collection('players_v14').doc('standard-previous').get()).get('credits'), 900);
  assert.equal((await db.collection('players_v14').doc('standard-buyer').get()).get('credits'), 700);
  assert.equal((await db.collection('market_v7').doc('standard-legacy-alias').get()).get('highestBidderId'), 'standard-buyer');

  await db.collection('players_v14').doc('pro-seller').set({ crystals: 0, ownedPlayers: [] });
  await db.collection('players_v14').doc('pro-previous').set({ crystals: 700, ownedPlayers: [] });
  await db.collection('players_v14').doc('pro-buyer').set({ crystals: 1000, ownedPlayers: [] });
  await db.collection('market_v7').doc('pro-legacy-alias').set({
    sellerId: 'pro-seller', isPro: true, currency: 'crystals',
    currentBid: 200, startingPrice: 200, highestBidderId: ' ', highestBidderUid: 'pro-previous',
    escrowCurrency: 'crystals', escrowedAmount: 200, expiresAt,
    heroData: { id: 'pro-legacy-player', name: 'PRO Legacy Player' },
  });
  await placeSpecialMarketBidWithDb(db, 'pro-buyer', 'pro-legacy-alias', 300, 'pro', now);
  assert.equal((await db.collection('players_v14').doc('pro-previous').get()).get('crystals'), 900);
  assert.equal((await db.collection('players_v14').doc('pro-buyer').get()).get('crystals'), 700);
  assert.equal((await db.collection('market_v7').doc('pro-legacy-alias').get()).get('highestBidderId'), 'pro-buyer');

  await db.collection('players_v14').doc('youth-seller').set({
    credits: 0,
    youthAcademyPlayers: [{ id: 'youth-legacy-player', name: 'Youth Legacy Player', onTransferUntil: expiresAt, transferMarketId: 'youth-legacy-alias' }],
  });
  await db.collection('players_v14').doc('youth-previous').set({ credits: 700, youthAcademyPlayers: [] });
  await db.collection('players_v14').doc('youth-buyer').set({ credits: 1000, youthAcademyPlayers: [] });
  await db.collection('market_v7').doc('youth-legacy-alias').set({
    sellerId: 'youth-seller', isYouth: true, currency: 'credits',
    currentBid: 100, startingPrice: 100, highestBidderId: ' ', highestBidderUid: 'youth-previous',
    escrowCurrency: 'credits', escrowedAmount: 100, expiresAt,
    heroData: { id: 'youth-legacy-player', name: 'Youth Legacy Player' },
  });
  await placeSpecialMarketBidWithDb(db, 'youth-buyer', 'youth-legacy-alias', 150, 'youth', now);
  assert.equal((await db.collection('players_v14').doc('youth-previous').get()).get('credits'), 800);
  assert.equal((await db.collection('players_v14').doc('youth-buyer').get()).get('credits'), 850);
  assert.equal((await db.collection('market_v7').doc('youth-legacy-alias').get()).get('highestBidderId'), 'youth-buyer');

  const ledger = await db.collection('economy_transactions').get();
  assert.equal(ledger.size, 6, 'each accepted outbid writes one escrow debit and one previous-bidder refund');
});

test('Firestore Emulator rejects a whitespace-padded PRO seller self-bid before charging escrow', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc('pro-seller').set({ crystals: 1000, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc('padded-pro-seller');
  await lotRef.set({
    sellerId: ' pro-seller ', isPro: true, currency: 'crystals',
    currentBid: 100, startingPrice: 100, highestBidderId: null, bidders: [],
    expiresAt, heroData: { id: 'pro-player', name: 'PRO Player' },
  });

  await assert.rejects(
    placeSpecialMarketBidWithDb(db, 'pro-seller', 'padded-pro-seller', 150, 'pro', now),
    /SELLER_CANNOT_BID/,
  );
  assert.equal((await db.collection('players_v14').doc('pro-seller').get()).get('crystals'), 1000);
  assert.equal((await lotRef.get()).get('highestBidderId'), null);
  assert.equal((await lotRef.get()).get('escrowedAmount'), undefined);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
});

test('Firestore Emulator settles a legacy lot through highestBidderUid when highestBidderId is blank', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const lotId = 'legacy-bidder-alias-settlement';
  const sellerId = 'legacy-alias-seller';
  const buyerId = 'legacy-alias-buyer';
  const playerId = 'legacy-alias-player';
  await db.collection('players_v14').doc(sellerId).set({
    credits: 10,
    ownedPlayers: [{ id: playerId, name: 'Legacy Alias Player', onTransferUntil: 'reserved', transferMarketId: lotId }],
  });
  await db.collection('players_v14').doc(buyerId).set({ credits: 700, ownedPlayers: [] });
  const lotRef = db.collection('market_v7').doc(lotId);
  await lotRef.set(expiredLot({
    sellerId,
    highestBidderId: '   ',
    highestBidderUid: buyerId,
    currentBid: 300,
    startingPrice: 200,
    escrowCurrency: 'credits',
    escrowedAmount: 300,
    heroData: { id: playerId, name: 'Legacy Alias Player' },
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 1);
  assert.equal(result.expiredWithoutSale, 0);
  assert.equal((await lotRef.get()).exists, false);
  const [seller, buyer] = await Promise.all([
    db.collection('players_v14').doc(sellerId).get(),
    db.collection('players_v14').doc(buyerId).get(),
  ]);
  assert.equal(seller.get('credits'), 295, 'seller receives the 300-credit sale less the 5% commission');
  assert.deepEqual(seller.get('ownedPlayers'), []);
  assert.equal(buyer.get('credits'), 700, 'valid escrow prevents a second buyer debit');
  assert.deepEqual(buyer.get('ownedPlayers').map(player => player.id), [playerId]);
  const ledger = await db.collection('economy_transactions').where('referenceId', '==', lotId).get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_CREDIT');
  assert.equal((await db.collection('transfer_history').get()).size, 1);
});


test('Firestore Emulator refunds a Youth auction when the buyer academy is full and unlocks only the matching seller lot', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const lotId = 'youth-capacity-lot';
  const sellerId = 'youth-capacity-seller';
  const buyerId = 'youth-capacity-buyer';
  const playerId = 'youth-capacity-player';
  const lockUntil = new Date(now + 60 * 60 * 1000).toISOString();
  const youthPlayer = {
    id: playerId,
    name: 'Capacity Youth',
    proStats: {},
    proTalents: {},
    onTransferUntil: lockUntil,
    transferMarketId: lotId,
  };
  await db.collection('players_v14').doc(sellerId).set({
    credits: 0,
    youthAcademyPlayers: [youthPlayer],
  });
  await db.collection('players_v14').doc(buyerId).set({
    credits: 0,
    academy: { youthBootcampLevel: 0 },
    youthAcademyPlayers: Array.from({ length: 10 }, (_, index) => ({ id: 'buyer-youth-' + index, proStats: {}, proTalents: {} })),
  });
  const lotRef = db.collection('market_v7').doc(lotId);
  await lotRef.set(expiredLot({
    sellerId,
    highestBidderId: buyerId,
    currentBid: 1000,
    startingPrice: 500,
    currency: 'credits',
    escrowCurrency: 'credits',
    escrowedAmount: 1000,
    expiresAt: new Date(now - 60_000).toISOString(),
    heroData: { id: playerId, name: 'Capacity Youth' },
    isYouth: true,
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 0);
  assert.equal(result.expiredWithoutSale, 1);
  assert.equal((await lotRef.get()).exists, false);

  const [seller, buyer] = await Promise.all([
    db.collection('players_v14').doc(sellerId).get(),
    db.collection('players_v14').doc(buyerId).get(),
  ]);
  assert.equal(seller.get('youthAcademyPlayers').length, 1);
  assert.equal(seller.get('youthAcademyPlayers')[0].transferMarketId, null);
  assert.equal(seller.get('youthAcademyPlayers')[0].onTransferUntil, null);
  assert.equal(buyer.get('credits'), 1000, 'the reserved bid amount is refunded in full');
  assert.equal(buyer.get('youthAcademyPlayers').length, 10);
  const refund = await db.collection('economy_transactions').where('referenceId', '==', lotId).get();
  assert.equal(refund.size, 1);
  assert.equal(refund.docs[0].get('type'), 'SPECIAL_AUCTION_SETTLEMENT_REFUND');
});

test('Firestore Emulator never sells or unlocks a youth player reserved by a different lot', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const oldLotId = 'youth-old-lot';
  const currentLotId = 'youth-current-lot';
  const sellerId = 'youth-lock-seller';
  const buyerId = 'youth-lock-buyer';
  const playerId = 'youth-lock-player';
  const currentLockUntil = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc(sellerId).set({
    credits: 0,
    youthAcademyPlayers: [{
      id: playerId,
      name: 'Locked Youth',
      proStats: {},
      proTalents: {},
      onTransferUntil: currentLockUntil,
      transferMarketId: currentLotId,
    }],
  });
  await db.collection('players_v14').doc(buyerId).set({ credits: 0, youthAcademyPlayers: [] });
  const oldLotRef = db.collection('market_v7').doc(oldLotId);
  await oldLotRef.set(expiredLot({
    sellerId,
    highestBidderId: buyerId,
    currentBid: 1000,
    startingPrice: 500,
    currency: 'credits',
    escrowCurrency: 'credits',
    escrowedAmount: 1000,
    expiresAt: new Date(now - 60_000).toISOString(),
    heroData: { id: playerId, name: 'Locked Youth' },
    isYouth: true,
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 0);
  assert.equal(result.expiredWithoutSale, 1);
  const [seller, buyer] = await Promise.all([
    db.collection('players_v14').doc(sellerId).get(),
    db.collection('players_v14').doc(buyerId).get(),
  ]);
  assert.equal(seller.get('youthAcademyPlayers')[0].transferMarketId, currentLotId);
  assert.equal(seller.get('youthAcademyPlayers')[0].onTransferUntil, currentLockUntil);
  assert.equal(buyer.get('credits'), 1000);
});


test('Firestore Emulator refunds a Youth auction when the buyer already owns the player in the senior roster', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  const now = Date.now();
  const lotId = 'youth-senior-duplicate-lot';
  const sellerId = 'youth-senior-duplicate-seller';
  const buyerId = 'youth-senior-duplicate-buyer';
  const playerId = 'youth-senior-duplicate-player';
  const lockUntil = new Date(now + 60 * 60 * 1000).toISOString();
  await db.collection('players_v14').doc(sellerId).set({
    credits: 0,
    youthAcademyPlayers: [{
      id: playerId,
      name: 'Duplicate Youth',
      proStats: {},
      proTalents: {},
      onTransferUntil: lockUntil,
      transferMarketId: lotId,
    }],
  });
  await db.collection('players_v14').doc(buyerId).set({
    credits: 0,
    ownedPlayers: [{ id: playerId, name: 'Already Senior', proStats: {}, proTalents: {}, isYouth: false }],
    youthAcademyPlayers: [],
    academy: {},
  });
  const lotRef = db.collection('market_v7').doc(lotId);
  await lotRef.set(expiredLot({
    sellerId,
    highestBidderId: buyerId,
    currentBid: 1000,
    startingPrice: 500,
    currency: 'credits',
    escrowCurrency: 'credits',
    escrowedAmount: 1000,
    expiresAt: new Date(now - 60_000).toISOString(),
    heroData: { id: playerId, name: 'Duplicate Youth' },
    isYouth: true,
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, true);
  assert.equal(result.sold, 0);
  assert.equal(result.expiredWithoutSale, 1);
  const [seller, buyer] = await Promise.all([
    db.collection('players_v14').doc(sellerId).get(),
    db.collection('players_v14').doc(buyerId).get(),
  ]);
  assert.equal(seller.get('youthAcademyPlayers')[0].transferMarketId, null);
  assert.equal(buyer.get('credits'), 1000);
  assert.equal(buyer.get('ownedPlayers').length, 1);
  assert.equal(buyer.get('youthAcademyPlayers').length, 0);
});
