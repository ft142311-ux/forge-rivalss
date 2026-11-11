import test from 'node:test';
import assert from 'node:assert/strict';
import { isCronAuthorized } from '../src/app/api/cron/cron-auth.ts';

function requestWithAuthorization(value) {
  const headers = new Headers();
  if (value !== undefined) headers.set('authorization', value);
  return { headers };
}

test('cron auth accepts only the exact configured Bearer token', () => {
  assert.equal(isCronAuthorized(requestWithAuthorization('Bearer secret'), 'secret'), true);
  assert.equal(isCronAuthorized(requestWithAuthorization('bearer secret'), 'secret'), false);
  assert.equal(isCronAuthorized(requestWithAuthorization('secret'), 'secret'), false);
  assert.equal(isCronAuthorized(requestWithAuthorization('Bearer other'), 'secret'), false);
  assert.equal(isCronAuthorized(requestWithAuthorization(undefined), 'secret'), false);
});

test('cron auth fails closed when the configured secret is missing or empty', () => {
  assert.equal(isCronAuthorized(requestWithAuthorization('Bearer undefined'), undefined), false);
  assert.equal(isCronAuthorized(requestWithAuthorization('Bearer '), ''), false);
});
