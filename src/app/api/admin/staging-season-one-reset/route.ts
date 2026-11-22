import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';
import { buildFreshSeasonOneResetPlan } from '@/app/actions/staging-season-one-reset-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EXPECTED_PROJECT = 'forge-rivalstest';

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}

/**
 * Read-only preflight for a fresh Beta Season 1.
 * This endpoint never mutates Firestore and never returns participant identifiers.
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
    return respond(403, { success: false, error: 'STAGING_PROJECT_MISMATCH', readOnly: true });
  }

  try {
    const db = getAdminDb();
    const matchPrefix = 'match_v140_S1_LALPHA_';
    const [configSnap, tablesSnap, slotsSnap, matchesSnap, cupSnap, cupMatchesSnap,
      legacyCupMatchesSnap, archiveSnap, archiveMatchesSnap, rolloverSnap, historySnap,
      matchEffectsSnap, matchRevenueSnap, leagueConsequenceSnap, cupConsequenceSnap,
      leagueSeasonRewardSnap, pyramidCupRewardSnap] = await Promise.all([
      db.collection('system_v1').doc('season_config').get(),
      db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 1).where('version', '==', 140).get(),
      db.collection('cup_pyramid_v1').doc('cup_s1_lALPHA').get(),
      db.collection('cup_matches').where('cupId', '==', 'cup_s1_lALPHA').get(),
      db.collection('matches_v2').where('cupId', '==', 'cup_s1_lALPHA').get(),
      db.collection('league_season_archives_v1').doc('S1').get(),
      db.collection('league_season_archives_v1').doc('S1').collection('matches').get(),
      db.collection('league_season_rollovers_v1').doc('S1').get(),
      db.collection('league_season_history_v1').doc('S1').get(),
      db.collection('match_player_effects_v1').where('matchId', '>=', matchPrefix).where('matchId', '<', `${matchPrefix}\uf8ff`).get(),
      db.collection('economy_transactions').where('referenceId', '>=', matchPrefix).where('referenceId', '<', `${matchPrefix}\uf8ff`).get(),
      db.collection('match_consequence_receipts').where('matchId', '>=', matchPrefix).where('matchId', '<', matchPrefix + '\uf8ff').get(),
      db.collection('match_consequence_receipts').where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff').get(),
      db.collection('economy_transactions').where('type', '==', 'LEAGUE_SEASON_REWARD').where('referenceId', '==', 'S1').get(),
      db.collection('economy_transactions').where('referenceId', '==', 'cup_s1_lALPHA').get(),
    ]);

    const participantIds = new Set<string>();
    let standingsShapeValid = tablesSnap.size === 15;
    for (const table of tablesSnap.docs) {
      const stats = table.data()?.stats;
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        standingsShapeValid = false;
        continue;
      }
      const rows = Object.entries(stats as Record<string, any>);
      if (rows.length !== 8) standingsShapeValid = false;
      const ranks = new Set<number>();
      for (const [key, value] of rows) {
        const id = String((value as any)?.id || key);
        const rank = Number((value as any)?.rank);
        if (id !== key || !Number.isInteger(rank) || rank < 1 || rank > 8 || ranks.has(rank) || participantIds.has(id)) {
          standingsShapeValid = false;
        }
        ranks.add(rank);
        participantIds.add(id);
      }
      if (ranks.size !== 8) standingsShapeValid = false;
    }

    const profileSnaps = standingsShapeValid && participantIds.size === 120
      ? await db.getAll(...[...participantIds].map(id => db.collection('players_v14').doc(id)))
      : [];
    const profileIds = new Set(profileSnaps.filter((profile, index) =>
      profile.exists && profile.data()?.id === [...participantIds][index]
    ).map(profile => String(profile.id)));

    const cupSnapshotDocs = await db.collection('cup_participant_snapshots_v1')
      .doc('cup_s1_lALPHA').collection('teams').get();

    const plan = buildFreshSeasonOneResetPlan({
      config: configSnap.exists ? configSnap.data() || {} : null,
      tables: tablesSnap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      slots: slotsSnap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      matches: matchesSnap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      profileIds,
      cupExists: cupSnap.exists,
      cupMatches: cupMatchesSnap.size + legacyCupMatchesSnap.size,
      cupSnapshots: cupSnapshotDocs.size,
      archives: archiveSnap.exists ? 1 : 0,
      rollovers: rolloverSnap.exists ? 1 : 0,
      history: historySnap.exists ? 1 : 0,
      archiveMatches: archiveMatchesSnap.size,
      matchPlayerEffects: matchEffectsSnap.size,
      matchRevenueReceipts: matchRevenueSnap.docs.filter(doc => doc.data()?.type === 'MATCH_REVENUE').length,
      matchConsequenceReceipts: leagueConsequenceSnap.size + cupConsequenceSnap.size,
      leagueSeasonRewardReceipts: leagueSeasonRewardSnap.size,
      pyramidCupRewardReceipts: pyramidCupRewardSnap.docs.filter(doc =>
        ['PYRAMID_CUP_CHAMPION_REWARD', 'PYRAMID_CUP_FINALIST_REWARD'].includes(String(doc.data()?.type || ''))).length,
    });

    return respond(plan.ready ? 200 : 409, {
      success: plan.ready,
      readOnly: true,
      project: EXPECTED_PROJECT,
      plan,
    });
  } catch (error) {
    console.error('[STAGING SEASON ONE RESET PREFLIGHT] Failed:', error);
    return respond(503, {
      success: false,
      readOnly: true,
      error: 'STAGING_SEASON_ONE_PREFLIGHT_UNAVAILABLE',
    });
  }
}
