import { NextRequest, NextResponse } from 'next/server';
import { controlDb, requireControlAdmin } from '../../../lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } });
}

export async function GET(request: NextRequest) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!match) return response(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });
  try {
    await requireControlAdmin(match[1]);
    const db = controlDb();
    const [configSnap, playersCount, cupSnap] = await Promise.all([
      db.collection('system_v1').doc('season_config').get(),
      db.collection('players_v14').count().get(),
      db.collection('cup_pyramid_v1').doc('cup_s1_lALPHA').get(),
    ]);
    const config = configSnap.exists ? configSnap.data() || {} : {};
    const cup = cupSnap.exists ? cupSnap.data() || {} : {};
    return response(200, {
      success: true,
      network: 'online',
      project: 'forge-rivals-beta',
      playersTotal: playersCount.data().count,
      season: {
        number: Number(config.activeSeasonNumber || 0),
        phase: String(config.phase || 'UNKNOWN'),
        worldReady: config.worldReady === true,
      },
      pyramidCup: {
        exists: cupSnap.exists,
        status: cup.status ? String(cup.status) : 'NOT_CREATED',
        currentRound: Number(cup.currentRound || 0),
        totalMatches: Number(cup.totalMatches || 0),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const code = String((error as Error)?.message || '');
    const denied = ['AUTHENTICATION_REQUIRED', 'CONTROL_ADMIN_REQUIRED'].includes(code) ||
      code.toLowerCase().includes('id-token') || code.toLowerCase().includes('token');
    return response(denied ? 403 : 503, {
      success: false,
      network: 'unavailable',
      error: denied ? code : 'CONTROL_OVERVIEW_UNAVAILABLE',
    });
  }
}
