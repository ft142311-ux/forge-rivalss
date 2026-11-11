import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getGlobalSeasonInfo } from '@/app/lib/time-utils';
import { logger } from '@/app/lib/logger';
import { ensureSeasonCalendar, publishPreparedSeason } from './season-calendar';
import { runTournamentCycle } from './tournament-system';
import { resolveDailyMatches } from './autonomous-cycle';
import { prepareSeasonRollover } from './season-rollover';
import { runSeasonActivationFlow } from './season-transition-flow';
import { validateRolloverPlan } from './season-rollover-plan';
import { isCalendarReady } from './season-calendar-gate';

/**
 * @fileOverview Глобальный оркестратор сезона v169.
 *
 * Важное правило архитектуры:
 *   1) ensureSeasonCalendar() строит и проверяет календарь;
 *   2) publishPreparedSeason() отдельно публикует следующий сезон;
 *   3) регистрация никогда не генерирует таблицы/слоты/матчи.
 */
export async function runSeasonOrchestrator() {
  try {
    let world: any = await ensureSeasonCalendar();
    // Do not run the broad daily match resolver when the calendar is blocked on
    // season rollover. prepareSeasonRollover owns settlement of the prior season
    // and validates the canonical fixture set before allowing the new season.
    const db = getAdminDb();
    let catchUp: any = { skipped: true, reason: 'ROLLOVER_GATE_FIRST' };
    const preparedWorldCanPublish = world?.prepared === true && world?.worldReady !== true;
    if (!world?.waitingForSeasonResults && !isCalendarReady(world) && !preparedWorldCanPublish) {
      return { action: 'WORLD_BUILDING' as const, worldReady: false, season: world?.seasonNumber, calendar: world };
    }
    if (world?.waitingForSeasonResults) {
      const configForRetry = await db.collection('system_v1').doc('season_config').get();
      const configData = configForRetry.exists ? configForRetry.data() || {} : {};
      const sourceSeason = Number(configData.activeSeasonNumber || world.seasonNumber || 1);
      const targetSeason = Number(world.targetSeasonNumber || sourceSeason + 1);

      // A missed scheduled start must not deadlock behind unfinished overdue
      // fixtures. Settle the configured active season first, then re-run the
      // rollover preflight. If settlement fails or fixtures remain incomplete,
      // leave publication blocked and let the next cron retry safely.
      catchUp = await resolveDailyMatches();
      if (catchUp?.success !== true) {
        logger.warn('Season rollover blocked because overdue-match settlement failed', catchUp);
        return { action: 'WAITING_FOR_SEASON_RESULTS' as const, worldReady: false, season: sourceSeason, rollover: { ready: false, reason: 'OVERDUE_MATCH_SETTLEMENT_FAILED' }, catchUp };
      }

      const rolloverRetry = await prepareSeasonRollover(db, sourceSeason, targetSeason);
      if (!rolloverRetry.ready) {
        logger.warn('Season rollover remains blocked after overdue-match catch-up', rolloverRetry);
        return { action: 'WAITING_FOR_SEASON_RESULTS' as const, worldReady: false, season: sourceSeason, rollover: rolloverRetry, catchUp };
      }
      // The rollover plan now exists. Run the idempotent calendar bootstrap again
      // in the same tick so the new season is provisioned without another day wait.
      world = await ensureSeasonCalendar();
      if ((world as any).waitingForSeasonResults || (world.worldReady !== true && world.prepared !== true)) {
        return { action: 'WORLD_BUILDING' as const, worldReady: false, season: world.seasonNumber, rollover: (world as any).rollover, catchUp };
      }
    }
    // If the scheduled start has passed and the canonical next-season world is
    // fully prepared, publish it from the regular orchestrator. This makes a
    // missed activation cron recoverable without bypassing the publication
    // transaction, rollover plan, canonical readiness gate, or write fence.
    if (world?.prepared === true && world?.worldReady !== true) {
      const activationAtMs = world.seasonStart ? new Date(world.seasonStart).getTime() : NaN;
      if (Number.isFinite(activationAtMs) && Date.now() >= activationAtMs) {
        const publication: any = await publishPreparedSeason();
        if (publication?.success !== true) {
          logger.warn('Prepared season is waiting for safe publication', publication);
          return { action: 'WORLD_BUILDING' as const, worldReady: false, season: world.seasonNumber, publication, calendar: world, catchUp };
        }
        world = { ...world, success: true, action: 'SEASON_PUBLISHED', worldReady: true, prepared: false, seasonNumber: publication.targetSeason || world.seasonNumber, publication };
      } else {
        return { action: 'WORLD_BUILDING' as const, worldReady: false, season: world.seasonNumber, reason: 'ACTIVATION_NOT_DUE', calendar: world, catchUp };
      }
    }

    if (!world?.waitingForSeasonResults && world?.worldReady === true) {
      catchUp = await resolveDailyMatches();
    }
    const tournaments = await runTournamentCycle(process.env.CRON_SECRET || '');


    const configRef = db.collection('system_v1').doc('season_config');

    // Finalize results during the offseason itself, not only when the next
    // calendar date rolls over. The archive/placement plan is the barrier for
    // advancing to GENERATING_NEXT.
    const beforeFinalizeSnap = await configRef.get();
    if (beforeFinalizeSnap.exists && (beforeFinalizeSnap.data() || {}).phase === 'FINALIZING') {
      const activeSeason = Number((beforeFinalizeSnap.data() || {}).activeSeasonNumber || world.seasonNumber || 1);
      const rollover = await prepareSeasonRollover(db, activeSeason, activeSeason + 1);
      if (!rollover.ready) {
        return { action: 'WAITING_FOR_SEASON_RESULTS' as const, worldReady: true, season: activeSeason, catchUp, rollover };
      }
    }

    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(configRef);
      if (!snap.exists) {
        return { action: 'WORLD_NOT_READY' as const };
      }

      const config = snap.data() || {};
      if (config.worldReady !== true) {
        return {
          action: 'WORLD_BUILDING' as const,
          season: Number(config.activeSeasonNumber || world.seasonNumber),
        };
      }

      const info = getGlobalSeasonInfo();
      const configuredSeasonStart = config.seasonStart ? new Date(config.seasonStart) : info.currentSeasonStart;
      const preparationAtMs = configuredSeasonStart.getTime() + 14 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000;
      const nowMs = Date.now();

      if (config.phase === 'REGULAR_SEASON' || config.phase === 'ACTIVE') {
        if (Number.isFinite(preparationAtMs) && nowMs >= preparationAtMs) {
          t.update(configRef, {
            phase: 'FINALIZING',
            offseasonStartedAt: FieldValue.serverTimestamp(),
            preparationStartedAt: FieldValue.serverTimestamp(),
            preparationTargetSeason: Number(config.activeSeasonNumber || world.seasonNumber || 1) + 1,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { action: 'START_FINALIZATION' as const };
        }
        return { action: 'RESOLVE_MATCHES' as const };
      }

      if (config.phase === 'FINALIZING') {
        t.update(configRef, {
          phase: 'GENERATING_NEXT',
          nextSeasonNumber: Number(config.activeSeasonNumber || 1) + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { action: 'GENERATE_NEXT' as const };
      }

      return { action: 'IDLE' as const, phase: config.phase };
    });

    return {
      ...result,
      worldReady: world.worldReady,
      season: world.seasonNumber,
      createdMatches: world.createdMatches,
      repairedMatches: world.repairedMatches,
      tournaments,
      matchSettlement: catchUp,
    };
  } catch (e: any) {
    logger.error('Orchestrator failed', e);
    return { action: 'ERROR' as const, error: e.message };
  }
}


/** Read the active season from the canonical config document. */
export async function getActiveSeasonNumber(db: any = getAdminDb()): Promise<number> {
  const snap = await db.collection('system_v1').doc('season_config').get();
  if (!snap.exists) return 1;
  const value = Number((snap.data() || {}).activeSeasonNumber || 1);
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

/**
 * Prepare the next season only after the prior season's archive and
 * promotion/relegation plan pass the canonical integrity checks.
 * The calendar bootstrap remains the single owner of world provisioning.
 */
export async function buildNextSeasonWorld() {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const snap = await configRef.get();
  if (!snap.exists) return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_CONFIG_MISSING' };
  const config = snap.data() || {};
  const sourceSeason = Number(config.activeSeasonNumber || 1);
  const configuredTargets = [config.nextSeasonNumber, config.preparationTargetSeason]
    .map((value: any) => Number(value))
    .filter((value: number) => Number.isSafeInteger(value) && value > sourceSeason && value <= sourceSeason + 1);
  const targetSeason = configuredTargets.length ? Math.max(...configuredTargets) : sourceSeason;
  if (!Number.isSafeInteger(targetSeason) || targetSeason < sourceSeason || targetSeason > sourceSeason + 1) {
    return { success: false, action: 'WORLD_NOT_READY', sourceSeason, targetSeason, reason: 'INVALID_TARGET_SEASON' };
  }
  const phase = String(config.phase || '').toUpperCase();
  const nextSeasonPreparationPhases = ['FINALIZING', 'GENERATING_NEXT', 'WORLD_BUILDING', 'PREPARING_NEXT_SEASON', 'PREPARATION'];
  if (targetSeason === sourceSeason + 1 && !nextSeasonPreparationPhases.includes(phase)) {
    return {
      success: false,
      action: 'WORLD_NOT_READY',
      sourceSeason,
      targetSeason,
      phase: phase || 'UNKNOWN',
      reason: 'TRANSITION_PHASE_NOT_READY',
      writesStarted: false,
    };
  }
  if (targetSeason === sourceSeason && config.worldReady === true) {
    return { success: true, action: 'NEXT_SEASON_READY', sourceSeason: Math.max(1, sourceSeason - 1), targetSeason, worldReady: true, alreadyPrepared: true };
  }

  let rollover: any = null;
  if (targetSeason === sourceSeason + 1) {
    const planSnap = await db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`).get();
    const savedPlan = planSnap.exists ? planSnap.data() || {} : null;
    if (validateRolloverPlan(savedPlan, sourceSeason, targetSeason).valid) {
      rollover = { ready: true, alreadyPrepared: true, sourceSeason, targetSeason };
    } else {
      rollover = await prepareSeasonRollover(db, sourceSeason, targetSeason);
    }
    if (!rollover.ready) {
      return { success: false, action: 'WAITING_FOR_SEASON_RESULTS', sourceSeason, targetSeason, rollover };
    }
  }
  const world: any = await ensureSeasonCalendar(targetSeason > sourceSeason ? targetSeason : undefined);
  return {
    success: world.success === true && Number(world.seasonNumber) === targetSeason,
    action: world.prepared === true ? 'NEXT_SEASON_PREPARED' : 'WORLD_BUILDING',
    sourceSeason: targetSeason > sourceSeason ? sourceSeason : Math.max(1, sourceSeason - 1), targetSeason, rollover, world,
  };
}

/**
 * Compatibility alias for existing callers. It is intentionally build-only;
 * publication is available only through publishPreparedSeason().
 */
export const generateNextSeasonWorld = buildNextSeasonWorld;

/** Prepare the next season through the canonical calendar path, then verify activation gates. */
export async function activateNextSeason() {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  return runSeasonActivationFlow({
    readConfig: async () => {
      const snap = await configRef.get();
      return snap.exists ? snap.data() || {} : null;
    },
    prepareNextSeason: async (sourceSeason, targetSeason) => {
      const build: any = await buildNextSeasonWorld();
      if (Number(build.sourceSeason) !== sourceSeason || Number(build.targetSeason) !== targetSeason) {
        return { ...build, success: false, action: build.action || 'WORLD_NOT_READY', reason: 'PREPARATION_TARGET_MISMATCH' };
      }
      if (build.success !== true || build.world?.prepared !== true) return build;
      return publishPreparedSeason();
    },
    readRollover: async (targetSeason) => {
      const snap = await db.collection('league_season_rollovers_v1').doc(`S${targetSeason}`).get();
      const rollover = snap.exists ? snap.data() || {} : null;
      return validateRolloverPlan(rollover, targetSeason - 1, targetSeason).valid ? rollover : null;
    },
  });
}

/**
 * Explicit one-shot recovery for the disposable Season 1 test world.
 * Do not use for later seasons: their normal strict rollover path is preserved.
 */
export async function finishTestSeason1AndPrepareSeason2() {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const initialSnap = await configRef.get();
  if (!initialSnap.exists) return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_CONFIG_MISSING' };
  const initial = initialSnap.data() || {};
  const sourceSeason = Number(initial.activeSeasonNumber || 1);
  if (sourceSeason !== 1) {
    return { success: false, action: 'RECOVERY_NOT_APPLICABLE', reason: 'ACTIVE_SEASON_IS_NOT_1', activeSeason: sourceSeason, writesStarted: false };
  }
  if (initial.worldReady !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: 'SEASON_1_WORLD_NOT_READY', writesStarted: false };
  }

  // Only table-stat reconciliation is waived. The rollover implementation still
  // requires all 15 tables, all 840 canonical fixtures, 56 fixtures per group,
  // eight unambiguous slots per group, and uses its normal lock/ledger/idempotency.
  const rollover = await prepareSeasonRollover(db, 1, 2, true);
  if (rollover?.ready !== true) {
    return { success: false, action: 'WAITING_FOR_SEASON_RESULTS', sourceSeason: 1, targetSeason: 2, rollover };
  }

  const transition = await db.runTransaction(async (tx: any) => {
    const fresh = await tx.get(configRef);
    if (!fresh.exists) return { success: false, reason: 'SEASON_CONFIG_MISSING' };
    const current = fresh.data() || {};
    if (Number(current.activeSeasonNumber || 1) !== 1) {
      return { success: false, reason: 'ACTIVE_SEASON_CHANGED', activeSeason: current.activeSeasonNumber };
    }
    if (current.worldReady !== true) return { success: false, reason: 'WORLD_NOT_READY' };
    tx.update(configRef, {
      phase: 'GENERATING_NEXT',
      nextSeasonNumber: 2,
      preparationTargetSeason: 2,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true };
  });
  if (transition?.success !== true) {
    return { success: false, action: 'WORLD_NOT_READY', reason: transition?.reason || 'TRANSITION_GATE_FAILED', transition, rollover };
  }

  // Provision and publish via the existing canonical path. Publication remains
  // fenced; if preparation fails, the normal orchestrator can retry it.
  const build: any = await buildNextSeasonWorld();
  if (build?.success !== true || build?.world?.prepared !== true) {
    return { success: false, action: build?.action || 'WORLD_BUILDING', reason: 'SEASON_2_PREPARATION_INCOMPLETE', rollover, build };
  }
  const publication: any = await publishPreparedSeason();
  return {
    success: publication?.success === true,
    action: publication?.success === true ? 'SEASON_2_PUBLISHED' : 'SEASON_2_PUBLICATION_BLOCKED',
    sourceSeason: 1,
    targetSeason: 2,
    rollover,
    build,
    publication,
  };
}
