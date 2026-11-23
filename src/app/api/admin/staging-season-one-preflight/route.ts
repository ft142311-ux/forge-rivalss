import { NextRequest, NextResponse } from 'next/server';
import { GET as getResetPreflight } from '../staging-season-one-reset/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EXPECTED_PROJECT = 'forge-rivalstest';
const EXPECTED_BRANCH = 'feature/beta-fresh-season-one';

/**
 * Read-only bridge for operators who can access the protected Vercel Preview
 * but cannot provision GitHub Actions secrets. Vercel Deployment Protection
 * remains the outer access gate. This route is Preview/branch/project fenced,
 * invokes only the reset route's GET handler, and never exposes CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';

  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH ||
    configuredProject !== EXPECTED_PROJECT
  ) {
    return NextResponse.json(
      { success: false, readOnly: true, error: 'BETA_PREVIEW_SCOPE_MISMATCH' },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, readOnly: true, error: 'PREVIEW_PREFLIGHT_AUTH_NOT_CONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  // Invoke the existing authenticated GET handler in-process. No HTTP request
  // is made, no secret is put in a URL, and the destructive POST is unreachable.
  const internalRequest = new NextRequest(request.url, {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  const preflightResponse = await getResetPreflight(internalRequest);
  const result = await preflightResponse.json();

  return NextResponse.json(result, {
    status: preflightResponse.status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
}
