import assert from 'node:assert/strict';
import test from 'node:test';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

test('registration HTTP boundary enforces content type and Firebase Auth Emulator tokens', {
  skip: !firestoreHost || !authHost,
}, async (t) => {
  assert.match(firestoreHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.match(authHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  assert.equal(process.env.GCLOUD_PROJECT || 'demo-forge-rivals', 'demo-forge-rivals');

  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
  const { POST } = await import('../src/app/api/registration/initialize/route.ts');

  await t.test('rejects unsupported content types before authentication', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'ignored',
    }));
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  });

  await t.test('rejects requests without a bearer token', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubName: 'Test Club' }),
    }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'AUTHENTICATION_REQUIRED');
  });

  await t.test('rejects malformed bearer tokens using Auth Emulator verification', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer definitely-not-a-valid-firebase-id-token',
      },
      body: JSON.stringify({ clubName: 'Test Club' }),
    }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'AUTH_TOKEN_INVALID');
  });

  await t.test('rejects oversized request bodies', async () => {
    const response = await POST(new Request('http://localhost/api/registration/initialize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '5000',
      },
      body: JSON.stringify({ clubName: 'Test Club' }),
    }));
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'REQUEST_TOO_LARGE');
  });
});
