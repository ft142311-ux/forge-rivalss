import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPECTED_PROJECT = 'forge-rivalstest';
const JOURNAL_ID = 'staging_fresh_season_one_reset_v1';
const CUP_ID = 'cup_s1_lALPHA';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

/**
 * Authenticated, read-only Beta world diagnostics.
 * Exposes aggregate counts and the reset journal's sanitized progress only;
 * never returns user IDs, club names, player data, tokens, or archived payloads.
 */
export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer ([^\\s]+)$/);
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
    const [configSnap, journalSnap, tablesSnap, slotsSnap, matchesSnap, cupSnap, cupMatchesSnap, cupSnapshotsSnap] =
      await Promise.all([
        db.collection('system_v1').doc('season_config').get(),
        db.collection('system_v1').doc(JOURNAL_ID).get(),
        db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
        db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
        db.collection('matches_v2').where('season', '==', 1).where('version', '==', 140).where('leagueId', '==', 'ALPHA').get(),
        db.collection('cup_pyramid_v1').doc(CUP_ID).get(),
        db.collection('cup_matches').where('cupId', '==', CUP_ID).get(),
        db.collection('cup_participant_snapshots_v1').doc(CUP_ID).collection('teams').get(),
      ]);

    const config = configSnap.exists ? configSnap.data() || {} : {};
    const journal = journalSnap.exists ? journalSnap.data() || {} : {};
    const leagueMatches = matchesSnap.docs.filter((doc: any) => {
      const data = doc.data() || {};
      const type = String(data.matchType || data.type || data.competitionType || '').toLowerCase();
      return !data.cupId && !data.tournamentId && !data.isFriendly &&
        !/(cup|tournament|friendly|scrim|association)/.test(type);
    });
    const cup = cupSnap.exists ? cupSnap.data() || {} : {};

    const diagnostic = {
      projectId,
      configExists: configSnap.exists,
      activeSeasonNumber: Number(config.activeSeasonNumber || 0),
      phase: String(config.phase || 'UNKNOWN'),
      worldReady: config.worldReady === true,
      stagingSeasonOneResetInProgress: config.stagingSeasonOneResetInProgress === true,
      stagingFreshSeasonOneReset: config.stagingFreshSeasonOneReset === true,
      worldGeneration: String(config.worldGeneration || ''),
      pyramidCupRequired: config.pyramidCupRequired === true,
      pyramidCupReady: config.pyramidCupReady === true,
      pyramidCupReadySeasonNumber: Number(config.pyramidCupReadySeasonNumber || 0),
      journalExists: journalSnap.exists,
      journalStatus: String(journal.status || 'MISSING'),
      journalStepIndex: Number(journal.stepIndex ?? -1),
      journalLastError: String(journal.lastError || '').slice(0, 120),
      journalLeaseActive: Number(journal.lease?.expiresAtMs || 0) > Date.now(),
      journalLeaseExpiresAtMs: Number(journal.lease?.expiresAtMs || 0),
      journalCounts: journal.counts && typeof journal.counts === 'object' ? journal.counts : {},
      tables: tablesSnap.size,
      slots: slotsSnap.size,
      leagueMatches: leagueMatches.length,
      cupExists: cupSnap.exists,
      cupParticipants: Array.isArray(cup.participants) ? cup.participants.length : 0,
      cupTotalMatches: Number(cup.totalMatches || 0),
      cupFirstRoundMatches: Array.isArray(cup.rounds?.r1) ? cup.rounds.r1.length : 0,
      cupMatchDocuments: cupMatchesSnap.size,
      cupParticipantSnapshots: cupSnapshotsSnap.size,
    };

    console.info('[WORLD STATUS DIAGNOSTICS]', diagnostic);
    return respond(200, { success: true, readOnly: true, diagnostic });
  } catch (error: any) {
    const code = String(error?.message || 'WORLD_STATUS_DIAGNOSTICS_FAILED')
      .replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 120);
    console.error('[WORLD STATUS DIAGNOSTICS] Failed:', code);
    return respond(503, { success: false, error: code });
  }
}
