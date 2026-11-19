import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getApps } from 'firebase-admin/app';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(status: number, body: Record<string, unknown>) {
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
 * Read-only, account-scoped diagnosis for league standings permission failures.
 * It deliberately verifies the token without running the activity fence so it
 * can report whether that fence's markers are the reason client reads are denied.
 * No UID, profile fields, marker contents, or other users' data are returned.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer ([^\s]+)$/);
  if (!tokenMatch) return respond(401, { success: false, code: 'AUTHENTICATION_REQUIRED' });

  try {
    const decoded = await getAuth().verifyIdToken(tokenMatch[1], true);
    const db = getAdminDb();
    const [pendingMarker, retiredMarker, profileSnapshot, seasonSnapshot] = await Promise.all([
      db.collection('inactive_club_retirements_v1').doc(decoded.uid).get(),
      db.collection('inactive_clubs_v1').doc(decoded.uid).get(),
      db.collection('players_v14').doc(decoded.uid).get(),
      db.collection('system_v1').doc('season_config').get(),
    ]);

    const profile = profileSnapshot.data() || {};
    const season = Math.max(1, Number(seasonSnapshot.data()?.activeSeasonNumber || 1));
    const leagueId = String(profile.selectedLeagueId || 'ALPHA');
    const level = Math.max(1, Number(profile.leagueLevel || 4));
    const group = Math.max(1, Number(profile.groupId || 1));
    const tableId = `table_v140_S${season}_L${leagueId}_V${level}_G${group}`;
    const tableSnapshot = await db.collection('league_tables_v2').doc(tableId).get();
    const projectId = getApps()[0]?.options.projectId || null;

    return respond(200, {
      success: true,
      projectId,
      profileExists: profileSnapshot.exists,
      activeSeason: season,
      tableExists: tableSnapshot.exists,
      accessFence: {
        pendingRetirement: pendingMarker.exists,
        retired: retiredMarker.exists,
        signedInGateAllows: !pendingMarker.exists && !retiredMarker.exists,
      },
    });
  } catch (error: unknown) {
    const code = String((error as any)?.code || '');
    const message = error instanceof Error ? error.message : 'DIAGNOSTIC_FAILED';
    const status = code.includes('user-disabled') ? 403 :
      code.includes('id-token-revoked') || code.includes('invalid-id-token') ? 401 : 503;
    console.error('[LEAGUE ACCESS DIAGNOSTIC] Failed:', message);
    return respond(status, {
      success: false,
      code: status === 401 ? 'AUTHENTICATION_FAILED' : status === 403 ? 'ACCOUNT_DISABLED' : 'DIAGNOSTIC_UNAVAILABLE',
    });
  }
}
