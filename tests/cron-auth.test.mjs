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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('legacy season recovery routes remain authenticated and disabled without writes', () => {
  const routes = [
    'src/app/api/cron/recover-season-gap/route.ts',
    'src/app/api/cron/reconstruct-sequential-seasons/route.ts',
    'src/app/api/cron/complete-recovered-season-two/route.ts',
  ];
  for (const file of routes) {
    const source = read(file);
    assert.match(source, /isCronAuthorized\(request\)/);
    assert.match(source, /status:\s*410/);
    assert.match(source, /writesStarted:\s*false/);
  }
});

test('active season orchestrator route is bearer-protected and uses fail-closed result policy', () => {
  const source = read('src/app/api/cron/season-orchestrator/route.ts');
  assert.match(source, /if \(!isCronAuthorized\(request\)\)/);
  assert.match(source, /isSeasonOrchestratorSuccessful\(result\)/);
  assert.match(source, /cronResultStatus\(response\)/);
});
