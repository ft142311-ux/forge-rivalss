import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } });
}

/** Authenticated public projection of the Pyramid Cup. Frozen roster snapshots are never returned. */
export async function POST(request: NextRequest) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer ([^\\s]+)$/)?.[1];
  if (!token) return respond(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });
  try {
    await requireServerActor(token);
    const db = getAdminDb();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    if (!configSnap.exists) return respond(503, { success: false, error: 'SEASON_CONFIG_MISSING' });
    const config = configSnap.data() || {};
    const activeSeason = Math.max(1, Number(config.activeSeasonNumber || 1));
    const phase = String(config.phase || '').toUpperCase();
    const preparedSeason = Number(config.preparedSeasonNumber || 0);
    const preparedPhase = ['GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED'].includes(phase);
    const season = config.preparedWorldReady === true && preparedPhase && preparedSeason > activeSeason
      ? preparedSeason : activeSeason;
    const cupId = `cup_s${season}_lALPHA`;
    const cupSnap = await db.collection('cup_pyramid_v1').doc(cupId).get();
    if (!cupSnap.exists) return respond(200, { success: true, exists: false, season, cup: null });
    const raw = cupSnap.data() || {};
    const participants = Array.isArray(raw.participants) ? raw.participants.map((team: any) => ({
      id: String(team?.id || ''), name: String(team?.name || team?.id || ''),
      level: Number(team?.level || 0), group: Number(team?.group || 0),
      rank: Number(team?.rank || 0), seed: Number(team?.seed || 0), isBot: team?.isBot === true,
    })) : [];
    const rounds: Record<string, any[]> = {};
    for (let round = 1; round <= 7; round++) {
      const source = Array.isArray(raw.rounds?.[`r${round}`]) ? raw.rounds[`r${round}`] : [];
      rounds[`r${round}`] = source.map((pairing: any) => ({
        id: String(pairing?.id || ''), index: Number(pairing?.index || 0),
        status: String(pairing?.status || 'scheduled'),
        home: pairing?.home ? { id: String(pairing.home.id || ''), name: String(pairing.home.name || pairing.home.id || ''), level: Number(pairing.home.level || 0), group: Number(pairing.home.group || 0), rank: Number(pairing.home.rank || 0), seed: Number(pairing.home.seed || 0), isBot: pairing.home.isBot === true } : null,
        away: pairing?.away ? { id: String(pairing.away.id || ''), name: String(pairing.away.name || pairing.away.id || ''), level: Number(pairing.away.level || 0), group: Number(pairing.away.group || 0), rank: Number(pairing.away.rank || 0), seed: Number(pairing.away.seed || 0), isBot: pairing.away.isBot === true } : null,
        matchId: pairing?.matchId ? String(pairing.matchId) : null,
        winnerId: pairing?.winnerId ? String(pairing.winnerId) : null,
        scoreA: pairing?.scoreA ?? null, scoreB: pairing?.scoreB ?? null,
      }));
    }
    const cup = {
      id: cupId, season, name: String(raw.name || 'Кубок Пирамиды'),
      status: String(raw.status || 'active'), currentRound: Number(raw.currentRound || 1),
      totalRounds: Number(raw.totalRounds || 7), totalMatches: Number(raw.totalMatches || 119),
      totalParticipants: participants.length, participants, rounds,
      winnerId: raw.winnerId || null, winnerName: raw.winnerName || null,
      finalistId: raw.finalistId || null, finalistName: raw.finalistName || null,
      seasonStart: raw.seasonStart || config.seasonStart || null,
    };
    return respond(200, { success: true, exists: true, season, cup });
  } catch (error: any) {
    const code = String(error?.message || 'CUP_READ_FAILED');
    const status = ['AUTH_TOKEN_INVALID','AUTH_TOKEN_REVOKED','AUTHENTICATION_REQUIRED'].includes(code) ? 401 :
      code === 'ACCOUNT_DISABLED' ? 403 : 503;
    return respond(status, { success: false, error: status === 503 ? 'CUP_UNAVAILABLE' : code });
  }
}
