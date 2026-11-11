type ActivationTarget = {
  activeSeason: number;
  targetSeason: number;
};

/** Resolve only the active season or its immediate successor from one config snapshot. */
function resolveActivationTarget(config: Record<string, any>): ActivationTarget {
  const activeSeason = Number(config.activeSeasonNumber || 1);
  const phase = String(config.phase || '').toUpperCase();
  const configuredTargets = [config.nextSeasonNumber, config.preparationTargetSeason]
    .map((value: any) => Number(value))
    .filter((value: number) => Number.isSafeInteger(value) && value > activeSeason && value <= activeSeason + 1);
  const configuredTarget = Number(config.nextSeasonNumber || config.preparationTargetSeason || 0);
  const phaseRequestsNext = ['FINALIZING', 'GENERATING_NEXT', 'WORLD_BUILDING', 'PREPARING_NEXT_SEASON', 'PREPARATION'].includes(phase)
    && !(config.worldReady === false && configuredTarget <= activeSeason);
  const targetSeason = configuredTargets.length
    ? Math.max(...configuredTargets)
    : (phaseRequestsNext ? activeSeason + 1 : activeSeason);

  return { activeSeason, targetSeason };
}

type ActivationDependencies = {
  readConfig: () => Promise<Record<string, any> | null>;
  prepareNextSeason: (sourceSeason: number, targetSeason: number) => Promise<Record<string, any>>;
  readRollover: (targetSeason: number) => Promise<Record<string, any> | null>;
};

/**
 * Ensure the requested next season has been provisioned before checking its
 * activation gates. The injected operations keep this ordering unit-testable.
 */
export async function runSeasonActivationFlow({
  readConfig,
  prepareNextSeason,
  readRollover,
}: ActivationDependencies) {
  let config = await readConfig();
  if (!config) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_CONFIG_MISSING' };
  }

  let { activeSeason, targetSeason } = resolveActivationTarget(config);
  let preparation: Record<string, any> | null = null;

  // A cron/manual retry must never publish the next season directly from the
  // regular season or from FINALIZING. The orchestrator may build in FINALIZING,
  // but publication is allowed only after it advances the config to
  // GENERATING_NEXT (WORLD_BUILDING is accepted for a resumable interrupted build).
  const initialPhase = String(config.phase || '').toUpperCase();
  if (targetSeason === activeSeason + 1 && !['GENERATING_NEXT', 'WORLD_BUILDING'].includes(initialPhase)) {
    return {
      success: false,
      action: 'WORLD_NOT_READY',
      reason: 'TRANSITION_PHASE_NOT_READY',
      sourceSeason: activeSeason,
      targetSeason,
      phase: initialPhase || 'UNKNOWN',
      worldReady: config.worldReady === true,
      writesStarted: false,
    };
  }

  if (targetSeason === activeSeason + 1) {
    preparation = await prepareNextSeason(activeSeason, targetSeason);
    if (preparation?.success !== true) {
      return {
        success: false,
        action: preparation?.action || 'WORLD_NOT_READY',
        sourceSeason: activeSeason,
        targetSeason,
        preparation,
      };
    }

    config = await readConfig();
    if (!config) {
      return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_CONFIG_MISSING' };
    }
    ({ activeSeason, targetSeason } = resolveActivationTarget(config));
  }

  if (targetSeason !== activeSeason || config.worldReady !== true) {
    return {
      success: false,
      action: 'WORLD_NOT_READY',
      sourceSeason: Math.max(1, activeSeason - 1),
      targetSeason,
      activeSeason,
      phase: String(config.phase || 'UNKNOWN'),
      worldReady: config.worldReady === true,
      reason: 'TARGET_SEASON_NOT_FULLY_PROVISIONED',
      ...(preparation ? { preparation } : {}),
    };
  }

  const rollover = await readRollover(activeSeason);
  if (!rollover || rollover.ready !== true || Number(rollover.targetSeason || activeSeason) !== activeSeason) {
    return {
      success: false,
      action: 'ROLLOVER_NOT_READY',
      activeSeason,
      targetSeason: activeSeason,
      reason: 'ARCHIVE_OR_PLACEMENT_PLAN_NOT_READY',
    };
  }

  return {
    success: true,
    action: 'SEASON_ACTIVATED',
    sourceSeason: Math.max(1, activeSeason - 1),
    targetSeason: activeSeason,
    worldReady: true,
    rollover,
  };
}
