import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runTransferMarketExpirySweepWithDb } from '../src/app/lib/auction-expiry-sweep.ts';
import { placeSpecialMarketBidWithDb, placeStandardMarketBidWithDb } from '../src/app/lib/auction-bid.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

async function withIsolatedFirestore(t) {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');
  const app = initializeApp({ projectId }, `auction-expiry-test-${randomUUID()}`);
  const firestore = getFirestore(app);
  const prefix = `auctionExpiryTest_${randomUUID().replaceAll('-', '')}_`;
  const names = ['market_v7', 'players_v14', 'economy_transactions', 'transfer_history', 'notifications_v7'];
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
  await db.collection('players_v14').doc('seller-1').set({ credits: 0 });
  await db.collection('players_v14').doc('youth-bidder').set({ credits: 800, crystals: 500 });
  await db.collection('market_v7').doc('youth-lot').set({
    sellerId: 'seller-1', isYouth: true, currency: 'credits',
    currentBid: 100, startingPrice: 100, highestBidderId: null,
    bidders: [], expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
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
  await db.collection('players_v14').doc('youth-seller').set({
    credits: 100,
    crystals: 900,
    youthAcademyPlayers: [{ id: 'youth-player', name: 'Youth Player', onTransferUntil: 'reserved', transferMarketId: 'youth-flow' }],
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
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
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
    ownedPlayers: [{ id: 'standard-player', name: 'Standard Player', onTransferUntil: 'reserved', transferMarketId: 'standard-flow' }],
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
  const settlement = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(settlement.success, true);
  assert.equal(settlement.sold, 1);
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
