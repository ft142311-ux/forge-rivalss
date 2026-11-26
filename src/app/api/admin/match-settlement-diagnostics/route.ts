import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireAdminActor } from '@/lib/server-auth';
import { resolveSeasonLifecycleWindow } from '@/app/actions/season-boundary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EXPECTED_PROJECT = 'forge-rivals-beta';
const CUP_ID_PREFIX = 'cup_s';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

function toMillis(value: any): number {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function isFinished(match: any): boolean {
  return match?.isFinished === true ||
    ['finished', 'completed'].includes(String(match?.status || '').toLowerCase());
}

function summarizeMatches(docs: any[], nowMs: number) {
  let finished = 0;
  let unfinished = 0;
  let overdue = 0;
  let processing = 0;
  let staleProcessing = 0;
  const errors: Array<{ code: string; count: number }> = [];
  const errorCounts = new Map<string, number>();

  for (const doc of docs) {
    const match = doc.data() || {};
    if (isFinished(match)) {
      finished++;
      continue;
    }
    unfinished++;
    const startMs = toMillis(match.startTime ?? match.scheduledAt);
    if (Number.isFinite(startMs) && startMs <= nowMs) overdue++;
    if (match.isProcessing === true) {
      processing++;
      const lockMs = toMillis(match.processingStartedAt ?? match.processingAt);
      if (Number.isFinite(lockMs) && nowMs - lockMs >= 15 * 60 * 1000) staleProcessing++;
    }
    const error = String(match.lastSettlementError || match.recoveryError || '').trim();
    if (error) errorCounts.set(error.slice(0, 120), (errorCounts.get(error.slice(0, 120)) || 0) + 1);
  }

  for (const [code, count] of [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    errors.push({ code, count });
  }
  return { total: docs.length, finished, unfinished, overdue, processing, staleProcessing, recentErrorCodes: errors };
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED', readOnly: true });

  try {
    const actor = await requireAdminActor(match[1]);
    if (!actor.isAdmin) return respond(403, { success: false, error: 'ADMIN_REQUIRED', readOnly: true });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message === 'ADMIN_REQUIRED' ? 403 : 401;
    return respond(status, { success: false, error: status === 403 ? 'ADMIN_REQUIRED' : 'AUTHENTICATION_FAILED', readOnly: true });
  }

  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';
  if (configuredProject !== EXPECTED_PROJECT ||
      (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') ||
      (process.env.VERCEL_GIT_COMMIT_REF && process.env.VERCEL_GIT_COMMIT_REF !== 'feature/beta-fresh-season-one')) {
    return respond(403, { success: false, error: 'BETA_PREVIEW_SCOPE_MISMATCH', readOnly: true });
  }

  try {
    const db = getAdminDb();
    const now = new Date();
    const nowMs = now.getTime();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    if (!configSnap.exists) {
      return respond(200, {
        success: true, readOnly: true, timestamp: now.toISOString(),
        project: EXPECTED_PROJECT, seasonConfigExists: false,
        reason: 'SEASON_CONFIG_MISSING', writesStarted: false,
      });
    }

    const config = configSnap.data() || {};
    const season = Number(config.activeSeasonNumber || 0);
    const phase = String(config.phase || 'UNKNOWN');
    let lifecycle: any = null;
    let lifecycleError: string | null = null;
    try {
      lifecycle = resolveSeasonLifecycleWindow({
        seasonStart: config.seasonStart,
        nextSeasonStart: config.nextSeasonStart,
        now,
      });
    } catch (error: any) {
      lifecycleError = String(error?.message || 'INVALID_SEASON_LIFECYCLE_WINDOW');
    }

    const [leagueSnap, cupSnap, rolloverLockSnap] = await Promise.all([
      db.collection('matches_v2').where('season', '==', season).where('version', '==', 140).get(),
      db.collection('cup_pyramid_v1').doc(`${CUP_ID_PREFIX}${season}_lALPHA`).get(),
      db.collection('system_v1').doc('season_rollover_v1').get(),
    ]);

    const leagueDocs = leagueSnap.docs.filter((doc: any) => {
      const match = doc.data() || {};
      return String(match.type || 'league').toLowerCase() === 'league';
    });
    const league = summarizeMatches(leagueDocs, nowMs);

    const cup = cupSnap.exists ? cupSnap.data() || {} : null;
    const cupRound = Number(cup?.currentRound || 0);
    const roundKey = cupRound > 0 ? `round_${cupRound}` : '';
    const pairings = roundKey && Array.isArray(cup?.rounds?.[roundKey]) ? cup.rounds[roundKey] : [];
    const cupIds = new Set<string>(pairings.flatMap((pairing: any) =>
      pairing?.matchId ? [String(pairing.matchId)] : []
    ));
    const [dedicatedCupSnap, legacyCupSnap] = await Promise.all([
      db.collection('cup_matches').where('cupId', '==', `cup_s${season}_lALPHA`).get(),
      db.collection('matches_v2').where('cupId', '==', `cup_s${season}_lALPHA`).get(),
    ]);
    const cupMatchDocs = new Map<string, any>();
    for (const doc of dedicatedCupSnap.docs) cupMatchDocs.set(doc.id, doc);
    for (const doc of legacyCupSnap.docs) cupMatchDocs.set(doc.id, doc);
    const cupCurrentRoundDocs = [...cupIds].map(id => cupMatchDocs.get(id)).filter(Boolean);
    const cupSummary = summarizeMatches(cupCurrentRoundDocs, nowMs);
    const rolloverLock = rolloverLockSnap.exists ? rolloverLockSnap.data() || {} : null;
    const rolloverLockExpiry = Number(rolloverLock?.expiresAtMs || 0);

    return respond(200, {
      success: true,
      readOnly: true,
      writesStarted: false,
      timestamp: now.toISOString(),
      project: EXPECTED_PROJECT,
      season: {
        activeSeasonNumber: season,
        phase,
        worldReady: config.worldReady === true,
        seasonStart: config.seasonStart?.toDate?.()?.toISOString?.() || config.seasonStart || null,
        nextSeasonStart: config.nextSeasonStart?.toDate?.()?.toISOString?.() || config.nextSeasonStart || null,
        lifecycle: lifecycle ? {
          offseasonStartAt: lifecycle.offseasonStartAt.toISOString(),
          leagueMatchesPaused: lifecycle.leagueMatchesPaused,
          activationDue: lifecycle.activationDue,
        } : null,
        lifecycleError,
      },
      league,
      pyramidCup: {
        exists: Boolean(cup),
        status: cup?.status || null,
        formatVersion: Number(cup?.formatVersion || 0),
        currentRound: cupRound || null,
        roundFixturesInBracket: pairings.length,
        roundFixturesWithMatchDocuments: cupCurrentRoundDocs.length,
        ...cupSummary,
      },
      rolloverLock: rolloverLock ? {
        exists: true,
        active: rolloverLockExpiry > nowMs,
        expiresAt: rolloverLockExpiry ? new Date(rolloverLockExpiry).toISOString() : null,
      } : { exists: false, active: false },
    });
  } catch (error: any) {
    console.error('[MATCH SETTLEMENT DIAGNOSTICS] Failed:', error);
    return respond(503, {
      success: false,
      readOnly: true,
      writesStarted: false,
      error: 'MATCH_SETTLEMENT_DIAGNOSTICS_UNAVAILABLE',
    });
  }
}
