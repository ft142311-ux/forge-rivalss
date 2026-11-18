import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/**
 * Authenticated server-authoritative profile bootstrap.
 * The caller can only read the player document belonging to the verified UID.
 * This is used for the initial app handoff; it does not grant client Firestore
 * access or weaken Firestore security rules.
 */
export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer ([^\s]+)$/);
  if (!tokenMatch) {
    return json(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });
  }

  try {
    const actor = await requireServerActor(tokenMatch[1]);
    const db = getAdminDb();
    const snapshot = await db.collection('players_v14').doc(actor.uid).get();

    if (!snapshot.exists) {
      return json(404, {
        success: false,
        error: 'PLAYER_PROFILE_NOT_FOUND',
        projectId: db.app.options.projectId || null,
      });
    }

    // Firestore Timestamp values are converted to JSON-safe representations.
    const profile = JSON.parse(JSON.stringify(snapshot.data() || {}));
    return json(200, {
      success: true,
      profile,
      projectId: db.app.options.projectId || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'PLAYER_PROFILE_READ_FAILED';
    const status =
      message === 'AUTHENTICATION_REQUIRED' ? 401 :
      message === 'ACCOUNT_DISABLED' || message === 'ACCOUNT_RETIRING' || message === 'ACCOUNT_RETIRED' ? 403 :
      message === 'AUTH_TOKEN_REVOKED' || message === 'AUTH_TOKEN_INVALID' ? 401 : 500;
    console.error('[PLAYER PROFILE API] Read failed:', message);
    return json(status, {
      success: false,
      error: status === 500 ? 'PLAYER_PROFILE_READ_FAILED' : message,
    });
  }
}
