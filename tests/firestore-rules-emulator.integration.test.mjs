import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || 'demo-forge-rivals';

test('Firestore rules enforce client access against the Auth and Firestore emulators', {
  skip: !firestoreHost || !authHost,
}, async (t) => {
  assert.match(firestoreHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.match(authHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(projectId, 'demo-forge-rivals');

  const app = initializeApp({ projectId }, `firestore-rules-test-${randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const runId = randomUUID();
  const email = `rules-owner-${runId}@example.test`;
  const password = `Rules-${randomUUID()}-Aa1!`;
  const otherEmail = `rules-other-${runId}@example.test`;
  const otherPassword = `Rules-${randomUUID()}-Bb2!`;
  const owner = await auth.createUser({ email, password, emailVerified: true });
  const other = await auth.createUser({ email: otherEmail, password: otherPassword, emailVerified: true });
  const refs = [
    db.collection('players_v14').doc(owner.uid),
    db.collection('players_v14').doc(other.uid),
    db.collection('matches_v2').doc(`rules-${runId}-match`),
    db.collection('league_tables_v2').doc(`rules-${runId}-table`),
    db.collection('league_slots_v1').doc(`rules-${runId}-slot`),
    db.collection('system_v1').doc(`rules-${runId}-system`),
    db.collection('market_v7').doc(`rules-${runId}-market`),
    db.collection('notifications_v7').doc(`rules-${runId}-notification`),
  ];

  t.after(async () => {
    await Promise.all(refs.map((ref) => ref.delete().catch(() => undefined)));
    await Promise.all([
      auth.deleteUser(owner.uid).catch(() => undefined),
      auth.deleteUser(other.uid).catch(() => undefined),
    ]);
    await deleteApp(app);
  });

  await Promise.all(refs.map((ref, index) => ref.set({ ownerUid: owner.uid, testRun: runId, index })));

  async function signIn(userEmail, userPassword) {
    const response = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: userPassword, returnSecureToken: true }),
      },
    );
    assert.equal(response.status, 200, 'Auth Emulator must issue an ID token');
    return (await response.json()).idToken;
  }

  const token = await signIn(email, password);
  const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;

  async function documentRequest(path, method = 'GET') {
    return fetch(`${baseUrl}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(method === 'PATCH'
        ? { body: JSON.stringify({ fields: { clientTamperProbe: { booleanValue: true } } }) }
        : {}),
    });
  }

  await t.test('a manager can read their own profile but not another manager profile', async () => {
    assert.equal((await documentRequest(`players_v14/${owner.uid}`)).status, 200);
    assert.equal((await documentRequest(`players_v14/${other.uid}`)).status, 403);
  });

  await t.test('public market data remains readable', async () => {
    assert.equal((await documentRequest(refs[6].path.replace(/\\//g, '/'))).status, 200);
  });

  await t.test('client writes are denied for server-authoritative game collections', async () => {
    const protectedPaths = [
      `players_v14/${owner.uid}`,
      refs[2].path,
      refs[3].path,
      refs[4].path,
      refs[5].path,
      refs[6].path,
      refs[7].path,
    ];
    for (const path of protectedPaths) {
      const response = await documentRequest(path, 'PATCH');
      assert.equal(response.status, 403, `client write must be denied for ${path}`);
    }
  });
});
