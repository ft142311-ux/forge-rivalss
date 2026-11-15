const ALLOWED_ACTIONS = new Set([
  'SEASON_ACTIVATED',
  'SEASON_PUBLISHED_WAITING_ACTIVATION',
  'START_FINALIZATION',
  'RESOLVE_MATCHES',
  'GENERATE_NEXT',
  'IDLE',
]);

const BLOCKED_ACTIONS = new Set([
  'ERROR',
  'WORLD_NOT_READY',
  'WORLD_BUILDING',
  'WAITING_FOR_SEASON_RESULTS',
  'ACTIVATION_BLOCKED',
  'PUBLICATION_BLOCKED',
]);

export function isSeasonOrchestratorSuccessful(result: any) {
  const action = String(result?.action || '');
  return result?.success !== false
    && ALLOWED_ACTIONS.has(action)
    && !BLOCKED_ACTIONS.has(action)
    && result?.worldReady === true
    && result?.matchSettlement?.success !== false
    && result?.tournaments?.success !== false
    && result?.publication?.success !== false
    && result?.activation?.success !== false
    && result?.activation?.historyCleanup?.pending !== true;
}

export function cronResultStatus(result: { success?: boolean }) {
  return result.success === true ? 200 : 409;
}
