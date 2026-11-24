import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { getTableId, getGroupsCountInLevel, MAX_LEVELS } from '@/app/lib/leagues-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

/** Authenticated read-only projection of public league standings.
 * Uses Admin SDK because the Beta project's deployed client rules currently
 * reject standings reads despite a valid active manager session. Only public
 * table fields are returned; no private player or club records are exposed.
 */
export async function POST(request: NextRequest) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer ([^\s]+)$/);
  if (!match) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });

  try {
    const actor = await requireServerActor(match[1]);
    const body = await request.json().catch(() => ({}));
    const db = getAdminDb();
    const ownProfileSnap = await db.collection('players_v14').doc(actor.uid).get();
    const ownProfile = ownProfileSnap.exists ? ownProfileSnap.data() || {} : null;
    const useOwnLeague = body?.scope === 'mine';
    if (useOwnLeague && !ownProfile) return respond(404, { success: false, error: 'MANAGER_PROFILE_NOT_FOUND' });
    const leagueId = String(useOwnLeague ? ownProfile?.selectedLeagueId || 'ALPHA' : body?.leagueId || 'ALPHA');
    const level = Number(useOwnLeague ? ownProfile?.leagueLevel : body?.level);
    const group = Number(useOwnLeague ? ownProfile?.groupId : body?.group);
    if (!/^[A-Z0-9_-]{2,20}$/.test(leagueId) ||
        !Number.isInteger(level) || level < 1 || level > MAX_LEVELS ||
        !Number.isInteger(group) || group < 1 || group > getGroupsCountInLevel(level)) {
      return respond(400, { success: false, error: 'INVALID_LEAGUE_TABLE_REQUEST' });
    }

    const configSnap = await db.collection('system_v1').doc('season_config').get();
    if (!configSnap.exists) return respond(503, { success: false, error: 'SEASON_CONFIG_MISSING' });
    const season = Math.max(1, Number(configSnap.data()?.activeSeasonNumber || 1));
    const tableId = getTableId(season, leagueId, level, group);
    const tableSnap = await db.collection('league_tables_v2').doc(tableId).get();
    if (!tableSnap.exists) return respond(200, { success: true, exists: false, season, tableId, leagueId, level, group, stats: null, viewer: useOwnLeague ? { rank: Number(ownProfile?.rank || 0), standingsEntryPresent: false } : undefined });

    const rawStats = tableSnap.data()?.stats;
    const stats: Record<string, Record<string, unknown>> = {};
    if (rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats)) {
      const publicFields = ['id', 'name', 'clubLogo', 'rank', 'matchesPlayed', 'wins', 'draws', 'losses', 'points', 'diff'];
      for (const [key, value] of Object.entries(rawStats as Record<string, any>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const row: Record<string, unknown> = {};
        for (const field of publicFields) {
          const item = value[field];
          if (['string', 'number', 'boolean'].includes(typeof item) || item === null) row[field] = item;
        }
        stats[key] = row;
      }
    }
    const viewerEntry = useOwnLeague ? stats[actor.uid] || null : null;
    return respond(200, { success: true, exists: true, season, tableId, leagueId, level, group, stats, viewer: useOwnLeague ? { rank: Number(ownProfile?.rank || 0), standingsEntryPresent: Boolean(viewerEntry), entryName: viewerEntry?.name || null, entryRank: Number(viewerEntry?.rank || 0) } : undefined });
  } catch (error: any) {
    const code = String(error?.message || 'LEAGUE_TABLE_READ_FAILED');
    const status = code === 'AUTHENTICATION_REQUIRED' || code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_REVOKED' ? 401 :
      code === 'ACCOUNT_DISABLED' ? 403 : 503;
    return respond(status, { success: false, error: status === 401 || status === 403 ? code : 'LEAGUE_TABLE_UNAVAILABLE' });
  }
}
