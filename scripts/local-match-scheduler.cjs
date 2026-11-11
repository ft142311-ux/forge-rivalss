'use strict';

const DEFAULT_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 280_000;
const LOCAL_ENDPOINT = 'http://127.0.0.1:9002/api/cron/resolve-matches';

function isLoopbackEmulatorHost(value) {
  return /^(127\.0\.0\.1|localhost):8080$/.test(String(value || '').trim());
}

function isLoopbackAuthEmulatorHost(value) {
  return /^(127\.0\.0\.1|localhost):9099$/.test(String(value || '').trim());
}

function validateLocalSchedulerConfig(env = process.env) {
  const projectId = String(env.GCLOUD_PROJECT || env.GCP_PROJECT || '').trim();
  const firestoreHost = String(env.FIRESTORE_EMULATOR_HOST || '').trim();
  const authHost = String(env.FIREBASE_AUTH_EMULATOR_HOST || '').trim();
  const secret = String(env.CRON_SECRET || '').trim();
  const emulatorMode = String(env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS || '').toLowerCase() === 'true';

  const errors = [];
  if (env.NODE_ENV === 'production') errors.push('NODE_ENV=production is not allowed');
  if (projectId !== 'demo-forge-rivals') errors.push('GCLOUD_PROJECT must be exactly demo-forge-rivals');
  if (!isLoopbackEmulatorHost(firestoreHost)) errors.push('FIRESTORE_EMULATOR_HOST must point to localhost:8080');
  if (!isLoopbackAuthEmulatorHost(authHost)) errors.push('FIREBASE_AUTH_EMULATOR_HOST must point to localhost:9099');
  if (!emulatorMode) errors.push('NEXT_PUBLIC_USE_FIREBASE_EMULATORS must be true');
  if (secret.length < 16) errors.push('CRON_SECRET must contain at least 16 characters');

  const rawInterval = env.LOCAL_MATCH_SCHEDULER_INTERVAL_MS;
  const intervalMs = rawInterval === undefined || rawInterval === ''
    ? DEFAULT_INTERVAL_MS
    : Number(rawInterval);
  if (!Number.isInteger(intervalMs) || intervalMs < 15_000 || intervalMs > 300_000) {
    errors.push('LOCAL_MATCH_SCHEDULER_INTERVAL_MS must be between 15000 and 300000');
  }

  return { ok: errors.length === 0, errors, projectId, intervalMs, secret };
}

async function runOnce(config, fetchImpl = fetch) {
  const response = await fetchImpl(LOCAL_ENDPOINT, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.secret}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 1000) }; }
  if (!response.ok) {
    const error = new Error(`Local match cron returned HTTP ${response.status}`);
    error.details = parsed;
    throw error;
  }
  return parsed;
}

async function main() {
  require('dotenv').config({ path: '.env.local' });
  const config = validateLocalSchedulerConfig(process.env);
  if (!config.ok) {
    console.error('[LOCAL MATCH SCHEDULER] BLOCKED. No request was sent:');
    for (const error of config.errors) console.error(` - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('[LOCAL MATCH SCHEDULER] Running in emulator-only mode.');
  console.log(`[LOCAL MATCH SCHEDULER] Project: ${config.projectId}`);
  console.log(`[LOCAL MATCH SCHEDULER] Endpoint: ${LOCAL_ENDPOINT}`);
  console.log(`[LOCAL MATCH SCHEDULER] Poll interval: ${config.intervalMs}ms`);
  console.log('[LOCAL MATCH SCHEDULER] Press Ctrl+C to stop.');

  let stopped = false;
  let inFlight = false;
  process.once('SIGINT', () => { stopped = true; console.log('\n[LOCAL MATCH SCHEDULER] Stopping after current request...'); });
  process.once('SIGTERM', () => { stopped = true; });

  while (!stopped) {
    if (!inFlight) {
      inFlight = true;
      const startedAt = Date.now();
      try {
        const result = await runOnce(config);
        console.log('[LOCAL MATCH SCHEDULER] Cycle completed', JSON.stringify({
          success: result.success,
          count: result.count,
          timestamp: result.timestamp,
          elapsedMs: Date.now() - startedAt,
          action: result.action,
          code: result.code,
        }));
        if (result.success === false) console.error('[LOCAL MATCH SCHEDULER] Cycle reported failure:', JSON.stringify(result));
      } catch (error) {
        console.error('[LOCAL MATCH SCHEDULER] Cycle failed:', error.message, error.details ? JSON.stringify(error.details) : '');
      } finally {
        inFlight = false;
      }
    }
    if (stopped) break;
    await new Promise(resolve => setTimeout(resolve, config.intervalMs));
  }
  console.log('[LOCAL MATCH SCHEDULER] Stopped.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('[LOCAL MATCH SCHEDULER] Fatal error:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_INTERVAL_MS, LOCAL_ENDPOINT, isLoopbackEmulatorHost, isLoopbackAuthEmulatorHost, validateLocalSchedulerConfig, runOnce };
