import { NextRequest, NextResponse } from 'next/server';
import { requireAdminActor } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EXPECTED_PROJECT = 'forge-rivals-beta';
const EXPECTED_BRANCH = 'feature/beta-fresh-season-one';
const CONFIRMATION = 'CREATE_BETA_SEASON_ONE';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

/**
 * Admin-authenticated bridge for the pristine Beta Season 1 bootstrap.
 * Firebase ID token + admin custom claim authorize the operator; CRON_SECRET
 * remains server-side and is forwarded only to the existing project-fenced,
 * empty-database-guarded bootstrap route. No reset or repair path is exposed.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!tokenMatch) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });

  try {
    await requireAdminActor(tokenMatch[1]);
  } catch (error: any) {
    const code = String(error?.message || 'AUTHENTICATION_FAILED');
    const status = code === 'ADMIN_REQUIRED' ? 403 : 401;
    return respond(status, { success: false, error: code });
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH ||
    projectId !== EXPECTED_PROJECT
  ) {
    return respond(403, {
      success: false,
      error: 'BETA_PREVIEW_SCOPE_MISMATCH',
      writesStarted: false,
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond(400, { success: false, error: 'INVALID_JSON_BODY' });
  }
  if (body?.confirmation !== CONFIRMATION) {
    return respond(400, {
      success: false,
      error: 'EXPLICIT_BOOTSTRAP_CONFIRMATION_REQUIRED',
      requiredConfirmation: CONFIRMATION,
      writesStarted: false,
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return respond(503, {
      success: false,
      error: 'BETA_BOOTSTRAP_AUTH_NOT_CONFIGURED',
      writesStarted: false,
    });
  }

  try {
    const internalRequest = new NextRequest(
      new URL('/api/admin/staging-world-bootstrap', request.url),
      {
        method: 'POST',
        headers: { authorization: `Bearer ${cronSecret}` },
      },
    );
    const { POST: runGuardedBootstrap } = await import('../staging-world-bootstrap/route');
    const result = await runGuardedBootstrap(internalRequest);
    const payload = await result.json();
    return respond(result.status, {
      ...payload,
      invokedBy: 'FIREBASE_ADMIN',
      writesStarted: payload?.writesStarted === true,
    });
  } catch (error) {
    console.error('[BETA SEASON ONE ADMIN BOOTSTRAP] Failed:', error);
    return respond(503, {
      success: false,
      error: 'BETA_BOOTSTRAP_BRIDGE_FAILED',
      writesStarted: false,
    });
  }
}
