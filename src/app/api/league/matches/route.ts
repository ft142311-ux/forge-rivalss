import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } });
}

/** Authenticated read-only projection of the manager's official group calendar. */
export async function POST(request: NextRequest) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer ([^\\s]+)$/)?.[1];
  if (!token) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });
  try {
    const actor = await requireServerActor(token);
    const body = await request.json().catch(() => ({}));
    const leagueId = String(body?.leagueId || '');
    const level = Number(body?.level);
    const group = Number(body?.group);
    const season = Number(body?.season);
    if (!/^[A-Z0-9_-]{2,20}$/.test(leagueId) || !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > Math.pow(2, level - 1) ||
        !Number.isSafeInteger(season) || season < 1) {
      return respond(400, { success: false, error: 'INVALID_LEAGUE_MATCH_REQUEST' });
    }
    const db = getAdminDb();
    const [profileSnap, configSnap] = await Promise.all([
      db.collection('players_v14').doc(actor.uid).get(),
      db.collection('system_v1').doc('season_config').get(),
    ]);
    if (!profileSnap.exists) return respond(404, { success: false, error: 'PLAYER_NOT_FOUND' });
    const profile = profileSnap.data() || {};
    if (String(profile.selectedLeagueId || 'ALPHA') !== leagueId ||
        Number(profile.leagueLevel) !== level || Number(profile.groupId) !== group) {
      return respond(403, { success: false, error: 'LEAGUE_SCOPE_MISMATCH' });
    }
    const activeSeason = Math.max(1, Number(configSnap.data()?.activeSeasonNumber || 1));
    if (season !== activeSeason) return respond(409, { success: false, error: 'SEASON_SCOPE_MISMATCH', activeSeason });
    const snapshot = await db.collection('matches_v2').where('season', '==', season).get();
    const matches = snapshot.docs.filter((doc: any) => {
      const raw = doc.data() || {};
      return String(raw.leagueId || '') === leagueId && Number(raw.level) === level && Number(raw.groupId) === group;
    }).map((doc: any) => {
      const raw = doc.data() || {};
      const start = raw.startTime?.toDate ? raw.startTime.toDate() :
        raw.startTime instanceof Date ? raw.startTime : new Date(raw.startTime || raw.scheduledAt || 0);
      return {
        id: doc.id, leagueId, season, level, groupId: group,
        homeId: String(raw.homeId || ''), awayId: String(raw.awayId || ''),
        homeName: String(raw.homeName || ''), awayName: String(raw.awayName || ''),
        homeLogo: typeof raw.homeLogo === 'string' ? raw.homeLogo : null,
        awayLogo: typeof raw.awayLogo === 'string' ? raw.awayLogo : null,
        homeRank: Number(raw.homeRank || 0), awayRank: Number(raw.awayRank || 0),
        tour: Number(raw.tour || raw.round || 0),
        startTime: Number.isFinite(start.getTime()) ? start.toISOString() : null,
        isFinished: raw.isFinished === true || ['finished','completed'].includes(String(raw.status || '').toLowerCase()),
        status: String(raw.status || ''), scoreA: raw.scoreA ?? raw.homeScore ?? null,
        scoreB: raw.scoreB ?? raw.awayScore ?? null, winnerId: raw.winnerId || null,
        type: String(raw.type || raw.matchType || 'league'),
      };
    }).sort((a: any, b: any) => a.tour - b.tour || String(a.id).localeCompare(String(b.id)));
    return respond(200, { success: true, season, leagueId, level, group, count: matches.length, matches });
  } catch (error: any) {
    const code = String(error?.message || 'LEAGUE_MATCH_READ_FAILED');
    const status = ['AUTH_TOKEN_INVALID','AUTH_TOKEN_REVOKED','AUTHENTICATION_REQUIRED'].includes(code) ? 401 :
      code === 'ACCOUNT_DISABLED' ? 403 : 503;
    return respond(status, { success: false, error: status === 503 ? 'LEAGUE_MATCHES_UNAVAILABLE' : code });
  }
}
