import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  GET as getResetPreflight,
  POST as executeReset,
} from '../staging-season-one-reset/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EXPECTED_PROJECT = 'forge-rivalstest';
const EXPECTED_BRANCH = 'feature/beta-fresh-season-one';
const RESET_JOURNAL_ID = 'staging_fresh_season_one_reset_v1';

function isExpectedPreview() {
  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';

  return (
    process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH &&
    configuredProject === EXPECTED_PROJECT
  );
}

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

async function readResetState() {
  const db = getAdminDb();
  const [configSnap, journalSnap, rolloverLockSnap, calendarLockSnap] = await Promise.all([
    db.collection('system_v1').doc('season_config').get(),
    db.collection('system_v1').doc(RESET_JOURNAL_ID).get(),
    db.collection('system_v1').doc('season_rollover_v1').get(),
    db.collection('system_v1').doc('season_calendar_build_v1').get(),
  ]);

  const config = configSnap.exists ? configSnap.data() || {} : {};
  const journal = journalSnap.exists ? journalSnap.data() || {} : null;
  const now = Date.now();
  const lockSummary = (snap: any) => ({
    exists: snap.exists,
    expiresAtMs: Number(snap.data()?.expiresAtMs || 0),
    active: snap.exists && Number(snap.data()?.expiresAtMs || 0) > now,
  });

  return {
    config: {
      activeSeasonNumber: Number(config.activeSeasonNumber || 0),
      phase: String(config.phase || ''),
      worldReady: config.worldReady === true,
      stagingSeasonOneResetInProgress: config.stagingSeasonOneResetInProgress === true,
      worldGeneration: String(config.worldGeneration || ''),
      pyramidCupReady: config.pyramidCupReady === true,
    },
    journal: journal ? {
      exists: true,
      status: String(journal.status || ''),
      resetId: String(journal.resetId || ''),
      stepIndex: Number(journal.stepIndex || 0),
      startedAtMs: Number(journal.startedAtMs || 0),
      updatedAtMs: Number(journal.updatedAtMs || 0),
      leaseExpiresAtMs: Number(journal.lease?.expiresAtMs || 0),
      leaseActive: Number(journal.lease?.expiresAtMs || 0) > now,
      lastError: String(journal.lastError || ''),
      counts: journal.counts && typeof journal.counts === 'object' ? journal.counts : {},
      hasSourceConfig: Boolean(journal.sourceConfig),
      target: journal.target || null,
    } : { exists: false },
    workerLocks: {
      seasonRollover: lockSummary(rolloverLockSnap),
      seasonCalendarBuild: lockSummary(calendarLockSnap),
    },
  };
}

/**
 * Protected Preview bridge for Beta Season 1 operations.
 * Vercel Deployment Protection remains the outer access gate. Both handlers
 * are branch/project fenced and use CRON_SECRET only in-process.
 */
export async function GET(request: NextRequest) {
  if (!isExpectedPreview()) {
    return respond(403, {
      success: false,
      readOnly: true,
      error: 'BETA_PREVIEW_SCOPE_MISMATCH',
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return respond(503, {
      success: false,
      readOnly: true,
      error: 'PREVIEW_PREFLIGHT_AUTH_NOT_CONFIGURED',
    });
  }

  const internalRequest = new NextRequest(request.url, {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  const preflightResponse = await getResetPreflight(internalRequest);
  const result = await preflightResponse.json();
  const diagnostics = await readResetState();

  return respond(preflightResponse.status, { ...result, diagnostics });
}

/**
 * Explicitly confirmed reset bridge. New resets require a fresh ready preflight.
 * Existing journaled resets may resume only after their lease expires; the
 * executor revalidates the journal lease and original archived source config.
 */
export async function POST(request: NextRequest) {
  if (!isExpectedPreview()) {
    return respond(403, {
      success: false,
      readOnly: false,
      error: 'BETA_PREVIEW_SCOPE_MISMATCH',
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(400, {
      success: false,
      readOnly: false,
      error: 'INVALID_JSON_BODY',
    });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    (body as { confirmation?: unknown }).confirmation !== 'RESET_BETA_SEASON_ONE'
  ) {
    return respond(400, {
      success: false,
      readOnly: false,
      error: 'EXPLICIT_RESET_CONFIRMATION_REQUIRED',
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return respond(503, {
      success: false,
      readOnly: false,
      error: 'PREVIEW_RESET_AUTH_NOT_CONFIGURED',
    });
  }

  const db = getAdminDb();
  const journalSnap = await db.collection('system_v1').doc(RESET_JOURNAL_ID).get();
  if (journalSnap.exists) {
    const journal = journalSnap.data() || {};
    const status = String(journal.status || '');
    if (!['RUNNING', 'FAILED', 'COMPLETED'].includes(status) ||
        !journal.target?.seasonStart || !journal.target?.nextSeasonStart ||
        (status !== 'COMPLETED' && !journal.sourceConfig)) {
      return respond(409, {
        success: false,
        readOnly: false,
        error: 'RESET_JOURNAL_INVALID_OR_UNRECOVERABLE',
      });
    }

    const leaseExpiresAtMs = Number(journal.lease?.expiresAtMs || 0);
    if (status === 'RUNNING' && leaseExpiresAtMs > Date.now()) {
      return respond(409, {
        success: false,
        readOnly: false,
        error: 'RESET_ALREADY_RUNNING',
        retryAfterMs: leaseExpiresAtMs - Date.now(),
        journal: {
          status,
          stepIndex: Number(journal.stepIndex || 0),
          leaseExpiresAtMs,
        },
      });
    }
  } else {
    const internalGet = new NextRequest(request.url, {
      method: 'GET',
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const preflightResponse = await getResetPreflight(internalGet);
    const preflight = await preflightResponse.json();

    if (
      preflightResponse.status !== 200 ||
      preflight?.success !== true ||
      preflight?.readOnly !== true ||
      preflight?.project !== EXPECTED_PROJECT ||
      preflight?.plan?.ready !== true
    ) {
      return respond(409, {
        success: false,
        readOnly: false,
        error: 'RESET_PREFLIGHT_BLOCKED',
        preflight: preflight?.plan || preflight?.error || 'PREFLIGHT_NOT_READY',
      });
    }
  }

  const internalPost = new NextRequest(request.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cronSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ confirmation: 'RESET_BETA_SEASON_ONE' }),
  });

  const executionResponse = await executeReset(internalPost);
  const execution = await executionResponse.json();
  return respond(executionResponse.status, execution);
}
