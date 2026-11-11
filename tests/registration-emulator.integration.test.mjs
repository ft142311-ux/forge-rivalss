import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

test('registration transaction integration tests require the isolated Firestore emulator', {
  skip: !emulatorHost,
}, async (t) => {
  assert.match(emulatorHost, /^(127\\.0\\.0\\.1|localhost):\\d+$/);
  assert.match(projectId, /^demo-forge-rivals$/);

  const app = initializeApp({ projectId }, `registration-test-${randomUUID()}`);
  const db = getFirestore(app);
  const runId = randomUUID();
  const testCollection = db.collection('__registration_integration_tests__');
  const ownedRefs = [];

  const track = (ref) => {
    ownedRefs.push(ref);
    return ref;
  };

  after(async () => {
    for (const ref of ownedRefs) {
      await ref.delete().catch(() => undefined);
    }
    await deleteApp(app);
  });

  await t.test('two concurrent first-time claims cannot occupy the same slot', async () => {
    const slotRef = track(testCollection.doc(`${runId}-slot`));
    const userARef = track(testCollection.doc(`${runId}-user-a`));
    const userBRef = track(testCollection.doc(`${runId}-user-b`));
    await slotRef.set({ status: 'FREE', occupantId: null });

    let firstReads = 0;
    let releaseFirstReads;
    const bothRead = new Promise((resolve) => { releaseFirstReads = resolve; });

    async function claim(userRef) {
      return db.runTransaction(async (transaction) => {
        const slot = await transaction.get(slotRef);
        if (!slot.exists || slot.get('status') !== 'FREE') return false;

        firstReads += 1;
        if (firstReads === 2) releaseFirstReads();
        if (firstReads <= 2) await bothRead;

        transaction.update(slotRef, {
          status: 'OCCUPIED',
          occupantId: userRef.id,
        });
        transaction.create(userRef, { created: true });
        return true;
      });
    }

    const results = await Promise.all([claim(userARef), claim(userBRef)]);
    assert.equal(results.filter(Boolean).length, 1);

    const finalSlot = await slotRef.get();
    assert.equal(finalSlot.get('status'), 'OCCUPIED');
    assert.ok([userARef.id, userBRef.id].includes(finalSlot.get('occupantId')));

    const [userA, userB] = await Promise.all([userARef.get(), userBRef.get()]);
    assert.equal(Number(userA.exists) + Number(userB.exists), 1);
  });

  await t.test('a repeated registration transaction is idempotent', async () => {
    const playerRef = track(testCollection.doc(`${runId}-idempotent-player`));
    const slotRef = track(testCollection.doc(`${runId}-idempotent-slot`));
    await slotRef.set({ status: 'FREE', occupantId: null });

    async function register() {
      return db.runTransaction(async (transaction) => {
        const existing = await transaction.get(playerRef);
        if (existing.exists) return { created: false };

        const slot = await transaction.get(slotRef);
        assert.equal(slot.get('status'), 'FREE');
        transaction.update(slotRef, {
          status: 'OCCUPIED',
          occupantId: playerRef.id,
        });
        transaction.create(playerRef, { initialized: true });
        return { created: true };
      });
    }

    assert.deepEqual(await register(), { created: true });
    assert.deepEqual(await register(), { created: false });
    assert.equal((await playerRef.get()).exists, true);
    assert.equal((await slotRef.get()).get('occupantId'), playerRef.id);
  });

  await t.test('a rejected transaction leaves slot and player documents unchanged', async () => {
    const slotRef = track(testCollection.doc(`${runId}-rollback-slot`));
    const playerRef = track(testCollection.doc(`${runId}-rollback-player`));
    await slotRef.set({ status: 'FREE', occupantId: null });

    await assert.rejects(
      db.runTransaction(async (transaction) => {
        const slot = await transaction.get(slotRef);
        assert.equal(slot.get('status'), 'FREE');
        transaction.update(slotRef, { status: 'OCCUPIED', occupantId: playerRef.id });
        transaction.create(playerRef, { initialized: true });
        throw new Error('SIMULATED_VALIDATION_FAILURE');
      }),
      /SIMULATED_VALIDATION_FAILURE/,
    );

    assert.equal((await slotRef.get()).get('status'), 'FREE');
    assert.equal((await slotRef.get()).get('occupantId'), null);
    assert.equal((await playerRef.get()).exists, false);
  });
});
