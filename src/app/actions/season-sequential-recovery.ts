import 'server-only';

/**
 * Legacy sequential recovery is intentionally disabled.
 * It reconstructed and activated multiple historical seasons in one operation,
 * bypassing the guarded prepare -> publish -> activate lifecycle.
 * Use the canonical season orchestrator for all season transitions.
 */
export async function reconstructSeasonTwoAndActivateSeasonThree() {
  return {
    success: false,
    reason: 'LEGACY_RECOVERY_DISABLED_USE_SEASON_ORCHESTRATOR',
    writesStarted: false,
  };
}
