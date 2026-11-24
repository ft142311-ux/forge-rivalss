import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPECTED_PROJECT = 'forge-rivals-beta';
const CUP_ID = 'cup_s1_lALPHA';
const CUP_COLLECTION = 'cup_pyramid_v1';
const SNAPSHOT_COLLECTION = 'cup_participant_snapshots_v1';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

function toDate(value: any): Date | null {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value?.toDate === 'function'
      ? value.toDate()
      : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Read-only, staging-only Pyramid Cup inspection.
 * Returns aggregate counts and format metadata only; no team names, UIDs,
 * rosters, tactics, match reports, or player financial data are exposed.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return respond(401, { success: false, error: 'UNAUTHORIZED', readOnly: true });
  }

  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';
  if (configuredProject !== EXPECTED_PROJECT) {
    return respond(403, {
      success: false,
      error: 'STAGING_PROJECT_MISMATCH',
      readOnly: true,
    });
  }

  try {
    const db = getAdminDb();
    const configRef = db.collection('system_v1').doc('season_config');
    const cupRef = db.collection(CUP_COLLECTION).doc(CUP_ID);
    const configSnap = await configRef.get();
    const config = configSnap.exists ? configSnap.data() || {} : {};
    const [cupSnap, dedicatedMatches, legacyMatches] = await Promise.all([
      cupRef.get(),
      db.collection('cup_matches').where('cupId', '==', CUP_ID).get(),
      db.collection('matches_v2').where('cupId', '==', CUP_ID).get(),
    ]);

    const seasonStart = toDate(config.seasonStart);
    const now = new Date();
    const seasonDay = seasonStart
      ? Math.floor((now.getTime() - seasonStart.getTime()) / 86400000) + 1
      : null;

    if (!cupSnap.exists) {
      return respond(200, {
        success: true,
        readOnly: true,
        activeSeason: Number(config.activeSeasonNumber || 0),
        phase: config.phase || null,
        seasonStart: seasonStart?.toISOString() || null,
        seasonDay,
        cupExists: false,
        cupId: CUP_ID,
        dedicatedMatches: dedicatedMatches.size,
        legacyMatches: legacyMatches.size,
        participantSnapshots: 0,
      });
    }

    const cup = cupSnap.data() || {};
    const [snapshotDocs] = await Promise.all([
      db.collection(SNAPSHOT_COLLECTION).doc(CUP_ID).collection('teams').get(),
    ]);
    const rounds = cup.rounds && typeof cup.rounds === 'object' ? cup.rounds : {};
    const roundSummary = Object.entries(rounds).map(([key, value]) => {
      const fixtures = Array.isArray(value) ? value : [];
      const participants = new Set<string>();
      let byes = 0;
      let finished = 0;
      for (const fixture of fixtures) {
        if (fixture?.home?.id) participants.add(String(fixture.home.id));
        if (fixture?.away?.id) participants.add(String(fixture.away.id));
        if (!fixture?.home?.id || !fixture?.away?.id) byes++;
        if (fixture?.status === 'finished') finished++;
      }
      return {
        round: key,
        fixtures: fixtures.length,
        participants: participants.size,
        byes,
        finished,
      };
    }).sort((a, b) => a.round.localeCompare(b.round, undefined, { numeric: true }));

    return respond(200, {
      success: true,
      readOnly: true,
      activeSeason: Number(config.activeSeasonNumber || 0),
      phase: config.phase || null,
      seasonStart: seasonStart?.toISOString() || null,
      nextSeasonStart: toDate(config.nextSeasonStart)?.toISOString() || null,
      seasonDay,
      cupExists: true,
      cupId: CUP_ID,
      cup: {
        status: cup.status || null,
        format: cup.format || null,
        formatVersion: Number(cup.formatVersion || 0),
        currentRound: Number(cup.currentRound || 0),
        totalMatches: Number(cup.totalMatches || 0),
        openingRoundRestTeams: Array.isArray(cup.openingRoundRestTeams)
          ? cup.openingRoundRestTeams.length
          : 0,
        rounds: roundSummary,
      },
      participantSnapshots: snapshotDocs.size,
      dedicatedMatches: dedicatedMatches.size,
      legacyMatches: legacyMatches.size,
    });
  } catch (error) {
    console.error('[STAGING CUP DIAGNOSTICS] Failed:', error);
    return respond(503, {
      success: false,
      error: 'STAGING_CUP_DIAGNOSTICS_UNAVAILABLE',
      readOnly: true,
    });
  }
}
