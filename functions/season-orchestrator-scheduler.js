'use strict';

const ORCHESTRATOR_PATH = '/api/cron/season-orchestrator';
const REQUEST_TIMEOUT_MS = 510_000;

function resolveOrchestratorUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('SEASON_ORCHESTRATOR_URL_MISSING');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('SEASON_ORCHESTRATOR_URL_INVALID');
  }

  if (parsed.protocol !== 'https:' ||
      parsed.pathname !== ORCHESTRATOR_PATH ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash) {
    throw new Error('SEASON_ORCHESTRATOR_URL_INVALID');
  }

  return parsed.toString();
}

async function invokeSeasonOrchestrator({
  url,
  secret,
  fetchImpl = globalThis.fetch,
}) {
  const endpoint = resolveOrchestratorUrl(url);
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error('CRON_SECRET_MISSING_OR_INVALID');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('FETCH_UNAVAILABLE');
  }

  const response = await fetchImpl(endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${secret.trim()}`,
      accept: 'application/json',
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('SEASON_ORCHESTRATOR_INVALID_RESPONSE');
  }

  if (!response.ok || payload?.success !== true) {
    throw new Error('SEASON_ORCHESTRATOR_UNSUCCESSFUL');
  }

  return {
    success: true,
    status: response.status,
    action: typeof payload.action === 'string' ? payload.action : null,
  };
}

module.exports = {
  ORCHESTRATOR_PATH,
  REQUEST_TIMEOUT_MS,
  resolveOrchestratorUrl,
  invokeSeasonOrchestrator,
};
