import { NextRequest, NextResponse } from 'next/server';
import { controlDb, requireControlAdmin } from '../../../lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPECTED_ROUNDS = [56, 32, 16, 8, 4, 2, 1];

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

function cleanDate(value: any): string | null {
  if (!value) return null;
  const date = value?.toDate?.() ?? new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function GET(request: NextRequest) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!match) return json(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });

  try {
    await requireControlAdmin(match[1]);
    const db = controlDb();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    if (!configSnap.exists) return json(503, { success: false, error: 'SEASON_CONFIG_MISSING' });
    const season = Number(configSnap.data()?.activeSeasonNumber || 0);
    if (!Number.isSafeInteger(season) || season < 1) return json(503, { success: false, error: 'ACTIVE_SEASON_INVALID' });

    const cupId = `cup_s${season}_lALPHA`;
    const cupSnap = await db.collection('cup_pyramid_v1').doc(cupId).get();
    if (!cupSnap.exists) {
      return json(200, { success: true, exists: false, season, cupId, issues: ['CUP_NOT_CREATED'], rounds: [] });
    }

    const cup = cupSnap.data() || {};
    const [dedicatedSnap, legacySnap] = await Promise.all([
      db.collection('cup_matches').where('cupId', '==', cupId).get(),
      db.collection('matches_v2').where('cupId', '==', cupId).get(),
    ]);
    const fixtures = new Map<string, any>();
    dedicatedSnap.docs.forEach(doc => fixtures.set(doc.id, { id: doc.id, ...doc.data(), storage: 'cup_matches' }));
    legacySnap.docs.forEach(doc => {
      if (!fixtures.has(doc.id)) fixtures.set(doc.id, { id: doc.id, ...doc.data(), storage: 'matches_v2' });
    });

    const roundsData = cup.rounds && typeof cup.rounds === 'object' ? cup.rounds : {};
    const issues: string[] = [];
    const rounds = EXPECTED_ROUNDS.map((expectedMatches, index) => {
      const round = index + 1;
      const pairings = Array.isArray(roundsData[`r${round}`]) ? roundsData[`r${round}`] : [];
      let finished = 0;
      let scheduled = 0;
      let missingFixtures = 0;
      let resultMismatches = 0;
      const matches = pairings.map((pairing: any) => {
        const fixture = pairing?.matchId ? fixtures.get(String(pairing.matchId)) : null;
        if (!fixture) {
          missingFixtures++;
          issues.push(`R${round}:M${pairing?.index || '?'}:FIXTURE_MISSING`);
        }
        const fixtureFinished = fixture?.isFinished === true || ['finished', 'completed'].includes(String(fixture?.status || '').toLowerCase());
        const hasWinner = Boolean(fixture?.winnerId);
        const isFinished = pairing?.status === 'finished' && Boolean(pairing?.winnerId);
        if (isFinished) finished++; else scheduled++;
        if (fixture && (fixtureFinished !== isFinished || (isFinished && String(fixture.winnerId) !== String(pairing.winnerId)))) {
          resultMismatches++;
          issues.push(`R${round}:M${pairing?.index || '?'}:BRACKET_RESULT_MISMATCH`);
        }
        if (fixture && fixtureFinished && !hasWinner) {
          issues.push(`R${round}:M${pairing?.index || '?'}:WINNER_MISSING`);
        }
        return {
          id: String(pairing?.id || ''),
          index: Number(pairing?.index || 0),
          matchId: pairing?.matchId || null,
          status: isFinished ? 'finished' : 'scheduled',
          home: pairing?.home ? { id: pairing.home.id, name: pairing.home.name, seed: pairing.home.seed, division: pairing.home.level, bot: pairing.home.isBot === true } : null,
          away: pairing?.away ? { id: pairing.away.id, name: pairing.away.name, seed: pairing.away.seed, division: pairing.away.level, bot: pairing.away.isBot === true } : null,
          scoreA: fixture?.scoreA ?? fixture?.homeScore ?? pairing?.scoreA ?? null,
          scoreB: fixture?.scoreB ?? fixture?.awayScore ?? pairing?.scoreB ?? null,
          winnerId: fixture?.winnerId || pairing?.winnerId || null,
          technicalDecision: fixture?.technicalDecision === true || pairing?.technicalDecision === true,
          fixtureStatus: fixture?.status || (fixtureFinished ? 'finished' : 'missing'),
          startAt: cleanDate(fixture?.scheduledAt || fixture?.startTime),
          storage: fixture?.storage || null,
          reportStatus: fixture?.reportStatus || null,
        };
      });
      if (pairings.length !== expectedMatches) issues.push(`R${round}:PAIRING_COUNT_${pairings.length}_EXPECTED_${expectedMatches}`);
      return { round, expectedMatches, pairingCount: pairings.length, finished, scheduled, missingFixtures, resultMismatches, matches };
    });

    const allMatches = rounds.reduce((sum, round) => sum + round.pairingCount, 0);
    const finishedMatches = rounds.reduce((sum, round) => sum + round.finished, 0);
    const scheduledMatches = rounds.reduce((sum, round) => sum + round.scheduled, 0);
    const duplicateStorageIds = dedicatedSnap.docs.filter(doc => legacySnap.docs.some(legacy => legacy.id === doc.id)).length;
    if (duplicateStorageIds) issues.push(`DUPLICATE_FIXTURE_STORAGE_IDS:${duplicateStorageIds}`);
    if (allMatches !== Number(cup.totalMatches || 0)) issues.push('CUP_TOTAL_MATCH_COUNT_MISMATCH');
    if (Number(cup.byeCount || 0) !== 0) issues.push('CUP_BYE_COUNT_NOT_ZERO');

    return json(200, {
      success: true,
      exists: true,
      season,
      cupId,
      name: String(cup.name || 'Кубок Пирамиды'),
      status: String(cup.status || 'unknown'),
      currentRound: Number(cup.currentRound || 0),
      totalRounds: Number(cup.totalRounds || 7),
      participants: Array.isArray(cup.participants) ? cup.participants.length : 0,
      totalMatches: Number(cup.totalMatches || 0),
      actualPairings: allMatches,
      finishedMatches,
      scheduledMatches,
      fixtureDocuments: fixtures.size,
      dedicatedFixtureDocuments: dedicatedSnap.size,
      legacyFixtureDocuments: legacySnap.size,
      winner: cup.winnerId ? { id: cup.winnerId, name: cup.winnerName || cup.winnerId } : null,
      rounds,
      issues,
      healthy: issues.length === 0,
      updatedAt: cleanDate(cup.updatedAt),
    });
  } catch (error) {
    const code = String((error as Error)?.message || '');
    const denied = ['AUTHENTICATION_REQUIRED', 'CONTROL_ADMIN_REQUIRED'].includes(code) ||
      code.toLowerCase().includes('id-token') || code.toLowerCase().includes('token');
    return json(denied ? 403 : 503, {
      success: false,
      error: denied ? code : 'CUP_CONTROL_UNAVAILABLE',
    });
  }
}
