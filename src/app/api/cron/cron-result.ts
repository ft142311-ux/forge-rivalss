export function isSeasonOrchestratorSuccessful(result: any) {
  const blockedActions = new Set([
    'ERROR',
    'WORLD_NOT_READY',
    'WORLD_BUILDING',
    'WAITING_FOR_SEASON_RESULTS',
    'ACTIVATION_BLOCKED',
  ]);
  return result?.success !== false
    && !blockedActions.has(String(result?.action || ''))
    && result?.worldReady !== false
    && result?.matchSettlement?.success !== false
    && result?.publication?.success !== false
    && result?.activation?.success !== false;
}

export function cronResultStatus(result: { success?: boolean }) {
  return result.success === true ? 200 : 409;
}
