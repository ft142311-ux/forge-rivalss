import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import scheduler from '../functions/season-orchestrator-scheduler.js';

const url = 'https://forge-rivals.example.com/api/cron/season-orchestrator';
const secret = 'test-secret-value-that-is-long-enough-123456';

test('scheduler invokes only the exact HTTPS season orchestrator route with bearer auth', async () => {
  let requestedUrl;
  let requestedOptions;

  const result = await scheduler.invokeSeasonOrchestrator({
    url,
    secret,
    fetchImpl: async (target, options) => {
      requestedUrl = target;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, action: 'SEASON_PUBLISHED_WAITING_ACTIVATION' }),
      };
    },
  });

  assert.equal(requestedUrl, url);
  assert.equal(requestedOptions.method, 'GET');
  assert.equal(requestedOptions.headers.authorization, `Bearer ${secret}`);
  assert.equal(requestedOptions.headers.accept, 'application/json');
  assert.equal(requestedOptions.cache, 'no-store');
  assert.equal(requestedOptions.redirect, 'error');
  assert.equal(requestedOptions.signal.aborted, false);
  assert.deepEqual(result, {
    success: true,
    status: 200,
    action: 'SEASON_PUBLISHED_WAITING_ACTIVATION',
  });
});

test('scheduler fails closed when endpoint or secret is missing or malformed', async () => {
  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({ url: '', secret }),
    /SEASON_ORCHESTRATOR_URL_MISSING/,
  );
  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({ url, secret: '' }),
    /CRON_SECRET_MISSING_OR_INVALID/,
  );
  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({
      url: 'http://forge-rivals.example.com/api/cron/season-orchestrator',
      secret,
    }),
    /SEASON_ORCHESTRATOR_URL_INVALID/,
  );
  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({
      url: 'https://forge-rivals.example.com/another-route',
      secret,
    }),
    /SEASON_ORCHESTRATOR_URL_INVALID/,
  );
});

test('scheduler treats HTTP errors and unsuccessful orchestrator payloads as failures', async () => {
  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({
      url,
      secret,
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({ success: false, action: 'ACTIVATION_BLOCKED' }),
      }),
    }),
    /SEASON_ORCHESTRATOR_HTTP_409/,
  );

  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({
      url,
      secret,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: false }),
      }),
    }),
    /SEASON_ORCHESTRATOR_UNSUCCESSFUL/,
  );
});

test('scheduler rejects non-JSON responses instead of recording a false success', async () => {
  await assert.rejects(
    scheduler.invokeSeasonOrchestrator({
      url,
      secret,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new Error('invalid json'); },
      }),
    }),
    /SEASON_ORCHESTRATOR_INVALID_RESPONSE/,
  );
});



test('App Hosting exposes cron and system credentials only to the server runtime', () => {
  const config = readFileSync(new URL('../apphosting.yaml', import.meta.url), 'utf8');
  assert.match(config, /^env:/m);
  assert.doesNotMatch(config, /^environmentVariables:/m);
  assert.match(config, /variable: CRON_SECRET\\s+secret: CRON_SECRET\\s+availability:\\s+- RUNTIME/s);
  assert.match(config, /variable: SYSTEM_ACCOUNT_PASSWORD\\s+secret: SYSTEM_ACCOUNT_PASSWORD\\s+availability:\\s+- RUNTIME/s);
  assert.match(config, /variable: NEXT_PUBLIC_FIREBASE_API_KEY\\s+value:/);
});

test('Firebase scheduled function provisions a five-minute UTC trigger with the cron secret bound', () => {
  const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('exports.runSeasonOrchestrator = functions');
  assert.notEqual(start, -1);
  const scheduledFunction = source.slice(start);
  assert.match(scheduledFunction, /\.schedule\('every 5 minutes'\)/);
  assert.match(scheduledFunction, /\.timeZone\('UTC'\)/);
  assert.match(scheduledFunction, /secrets:\s*\['CRON_SECRET'\]/);
  assert.match(scheduledFunction, /process\.env\.SEASON_ORCHESTRATOR_URL/);
  assert.match(scheduledFunction, /process\.env\.CRON_SECRET/);
  assert.match(scheduledFunction, /maxInstances:\s*1/);
  assert.match(scheduledFunction, /invokeSeasonOrchestrator\(/);
});
