import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { runTransferMarketExpirySweepWithDb } from '../src/app/lib/auction-expiry-sweep.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

async function withIsolatedFirestore(t) {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');
  const app = initializeApp({ projectId }, `auction-expiry-test-${randomUUID()}`);
  const firestore = getFirestore(app);
  const prefix = `auctionExpiryTest_${randomUUID().replaceAll('-', '')}_`;
  const names = ['market_v7', 'players_v14', 'economy_transactions', 'transfer_history'];
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

test('Firestore Emulator leaves a lot untouched when its recorded escrow is malformed', {
  skip: !emulatorHost,
}, async t => {
  const { db } = await withIsolatedFirestore(t);
  await db.collection('players_v14').doc('seller-1').set({
    credits: 200,
    ownedPlayers: [{ id: 'hero-1', name: 'Test Hero' }],
  });
  await db.collection('players_v14').doc('buyer-1').set({ credits: 700, ownedPlayers: [] });
  await db.collection('market_v7').doc('lot-corrupt').set(expiredLot({
    escrowedAmount: 'corrupt',
  }));

  const result = await runTransferMarketExpirySweepWithDb(db);
  assert.equal(result.success, false);
  assert.match(result.errors[0].error, /AUCTION_ESCROW_AMOUNT_INVALID/);
  assert.equal((await db.collection('market_v7').doc('lot-corrupt').get()).exists, true);
  assert.equal((await db.collection('players_v14').doc('buyer-1').get()).get('credits'), 700);
  assert.equal((await db.collection('players_v14').doc('seller-1').get()).get('credits'), 200);
  assert.equal((await db.collection('economy_transactions').get()).size, 0);
  assert.equal((await db.collection('transfer_history').get()).size, 0);
});
