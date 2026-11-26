import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPECTED_PROJECT = 'forge-rivals-beta';
const EXPECTED_BRANCH = 'feature/beta-fresh-season-one';
const ALLOWED_UID = 'nMG9UEAaoTYhZkno3107pCp6y5i2';
const CONFIRMATION = 'GRANT_BETA_ADMIN_TO_MY_ACCOUNT';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

/**
 * Narrow self-provisioning bridge for the single Beta UID explicitly supplied
 * by the project owner. The caller must prove ownership with a valid Firebase
 * ID token for that exact UID. Project, branch and Preview fences are mandatory.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });

  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH ||
    (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) !== EXPECTED_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== EXPECTED_PROJECT
  ) {
    return respond(403, { success: false, error: 'BETA_PREVIEW_SCOPE_MISMATCH', writesStarted: false });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond(400, { success: false, error: 'INVALID_JSON_BODY', writesStarted: false });
  }
  if (body?.confirmation !== CONFIRMATION) {
    return respond(400, { success: false, error: 'EXPLICIT_ADMIN_GRANT_CONFIRMATION_REQUIRED', writesStarted: false });
  }

  try {
    // Initialize and project-fence the Admin SDK before touching Auth.
    getAdminDb();
    const decoded = await getAuth().verifyIdToken(match[1], true);
    if (decoded.uid !== ALLOWED_UID) {
      return respond(403, { success: false, error: 'BETA_ADMIN_UID_NOT_ALLOWLISTED', writesStarted: false });
    }

    const auth = getAuth();
    const user = await auth.getUser(ALLOWED_UID);
    if (user.customClaims?.admin === true) {
      return respond(200, { success: true, alreadyAdmin: true, uid: ALLOWED_UID, writesStarted: false });
    }

    await auth.setCustomUserClaims(ALLOWED_UID, {
      ...(user.customClaims || {}),
      admin: true,
    });

    console.info('[BETA ADMIN CLAIM BOOTSTRAP]', { uid: ALLOWED_UID, projectId: EXPECTED_PROJECT });
    return respond(200, {
      success: true,
      adminGranted: true,
      uid: ALLOWED_UID,
      refreshRequired: true,
      writesStarted: true,
    });
  } catch (error: any) {
    const code = String(error?.code || error?.message || 'ADMIN_CLAIM_GRANT_FAILED');
    const status = code.includes('id-token-revoked') || code.includes('id-token-expired') || code.includes('invalid-id-token') ? 401 : 503;
    console.error('[BETA ADMIN CLAIM BOOTSTRAP] Failed:', { code });
    return respond(status, { success: false, error: 'BETA_ADMIN_CLAIM_GRANT_FAILED', writesStarted: false });
  }
}
