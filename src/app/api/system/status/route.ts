import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPECTED_PROJECT = 'forge-rivals-beta';
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

/** Minimal authenticated system overview: network health and aggregate player counts only. */
export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });

  try {
    const actor = await requireServerActor(match[1]);
    if (!actor.uid) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });

    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'unknown';
    if (projectId !== EXPECTED_PROJECT) {
      return respond(403, { success: false, error: 'STAGING_PROJECT_MISMATCH' });
    }

    const db = getAdminDb();
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    const players = db.collection('players_v14');
    const [totalSnapshot, onlineSnapshot] = await Promise.all([
      players.count().get(),
      players.where('lastLoginDate', '>=', cutoff).count().get(),
    ]);

    return respond(200, {
      success: true,
      network: 'online',
      totalPlayers: totalSnapshot.data().count,
      onlinePlayers: onlineSnapshot.data().count,
      onlineWindowMinutes: ONLINE_WINDOW_MS / 60_000,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    const code = String(error?.message || 'SYSTEM_STATUS_UNAVAILABLE')
      .replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 100);
    console.error('[SYSTEM STATUS] Failed:', code);
    return respond(503, { success: false, network: 'offline', error: 'SYSTEM_STATUS_UNAVAILABLE' });
  }
}
