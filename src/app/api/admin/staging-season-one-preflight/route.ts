import { NextRequest, NextResponse } from 'next/server';
import {
  GET as getResetPreflight,
  POST as executeReset,
} from '../staging-season-one-reset/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EXPECTED_PROJECT = 'forge-rivalstest';
const EXPECTED_BRANCH = 'feature/beta-fresh-season-one';

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

  return respond(preflightResponse.status, result);
}

/**
 * Explicitly confirmed reset bridge. It always performs a fresh read-only
 * preflight immediately before invoking the existing authenticated executor.
 * No secret is accepted from or returned to the caller.
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
