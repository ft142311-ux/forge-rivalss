import { NextRequest, NextResponse } from 'next/server';
import { getApps } from 'firebase-admin/app';
import { getAdminDb } from '@/lib/firebase-admin';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';
import { buildFreshSeasonOneResetPlan } from '@/app/actions/staging-season-one-reset-plan';
import { executeFreshSeasonOneReset } from '@/app/actions/fresh-season-one-reset-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EXPECTED_PROJECT = 'forge-rivals-beta';
const EXPECTED_BRANCH = 'feature/beta-fresh-season-one';

function isExpectedProject() {
  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';
  const initializedProject = getApps()[0]?.options?.projectId;
  return process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH &&
    configuredProject === EXPECTED_PROJECT &&
    (!initializedProject || initializedProject === EXPECTED_PROJECT);
}

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

  if (!isExpectedProject()) {
    return respond(403, { success: false, error: 'STAGING_PROJECT_MISMATCH', readOnly: true });
  }

  try {
    const db = getAdminDb();
    const matchPrefix = 'match_v140_S1_LALPHA_';
    const [configSnap, tablesSnap, slotsSnap, matchesSnap, allProfilesSnap, cupSnap, cupMatchesSnap,
      archiveSnap, archiveMatchesSnap, rolloverSnap, historySnap,
      matchEffectsSnap, matchRevenueSnap, cupMatchRevenueSnap, leagueConsequenceSnap, cupConsequenceSnap,
      leagueSeasonRewardSnap, pyramidCupRewardSnap, slotHistorySnap, rolloverLockSnap, calendarLockSnap] = await Promise.all([
      db.collection('system_v1').doc('season_config').get(),
      db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
      db.collection('matches_v2').where('season', '==', 1).where('version', '==', 140).get(),
      db.collection('players_v14').get(),
      db.collection('cup_pyramid_v1').doc('cup_s1_lALPHA').get(),
      db.collection('cup_matches').where('cupId', '==', 'cup_s1_lALPHA').get(),
      db.collection('league_season_archives_v1').doc('S1').get(),
      db.collection('league_season_archives_v1').doc('S1').collection('matches').get(),
      db.collection('league_season_rollovers_v1').doc('S2').get(),
      db.collection('league_season_history_v1').doc('S1').get(),
      db.collection('match_player_effects_v1').where('matchId', '>=', matchPrefix).where('matchId', '<', `${matchPrefix}\uf8ff`).get(),
      db.collection('economy_transactions').where('referenceId', '>=', matchPrefix).where('referenceId', '<', `${matchPrefix}\uf8ff`).get(),
      db.collection('economy_transactions').where('referenceId', '>=', 'cup_S1_').where('referenceId', '<', 'cup_S1_\uf8ff').get(),
      db.collection('match_consequence_receipts').where('matchId', '>=', matchPrefix).where('matchId', '<', matchPrefix + '\uf8ff').get(),
      db.collection('match_consequence_receipts').where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff').get(),
      db.collection('economy_transactions').where('referenceId', '==', 'S1').get(),
      db.collection('economy_transactions').where('referenceId', '==', 'cup_s1_lALPHA').get(),
      db.collection('league_slot_history_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA').get(),
      db.collection('system_v1').doc('season_rollover_v1').get(),
      db.collection('system_v1').doc('season_calendar_build_v1').get(),
    ]);

    const isLeagueFixture = (data: Record<string, any>) => {
      const type = String(data.matchType || data.type || data.competitionType || '').toLowerCase();
      return String(data.leagueId || '') === 'ALPHA' && !data.cupId && !data.tournamentId &&
        !data.isFriendly && !/(cup|tournament|friendly|scrim|association)/.test(type);
    };
    const isKnownIndependentFixture = (data: Record<string, any>) => {
      const type = String(data.matchType || data.type || data.competitionType || '').toLowerCase();
      return Boolean(data.cupId || data.tournamentId || data.isFriendly ||
        /(cup|tournament|friendly|scrim|association)/.test(type));
    };
    const leagueMatchDocs = matchesSnap.docs.filter(doc => isLeagueFixture(doc.data() || {}));
    // Some older Cup matches were stored in matches_v2 before cup_matches became
    // the dedicated collection. Count them separately so reset can delete only
    // the exact Season 1 Pyramid Cup records without touching other competitions.
    const legacyCupMatchDocs = matchesSnap.docs.filter(doc => {
      const data = doc.data() || {};
      return data.cupId === 'cup_s1_lALPHA' || doc.id.startsWith('cup_S1_');
    });
    const unclassifiedMatches = matchesSnap.docs.filter(doc => {
      const data = doc.data() || {};
      return !isLeagueFixture(data) && !isKnownIndependentFixture(data) && !doc.id.startsWith('cup_S1_');
    }).length;

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
    const profileIds = new Set(profileSnaps.filter(profile =>
      profile.exists && participantIds.has(String(profile.id)) &&
      profile.data()?.id === String(profile.id) &&
      Array.isArray(profile.data()?.ownedPlayers) && profile.data()!.ownedPlayers.length >= 5
    ).map(profile => String(profile.id)));

    const cupSnapshots = await db.collection('cup_participant_snapshots_v1')
      .doc('cup_s1_lALPHA').collection('teams').get();

    const plan = buildFreshSeasonOneResetPlan({
      config: configSnap.exists ? configSnap.data() || {} : null,
      tables: tablesSnap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      slots: slotsSnap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      matches: leagueMatchDocs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      legacyCupMatches: legacyCupMatchDocs.length,
      profileIds,
      unexpectedProfileCount: allProfilesSnap.docs.filter(doc => !participantIds.has(doc.id)).length,
      cup: cupSnap.exists ? cupSnap.data() || {} : null,
      cupFixtures: cupMatchesSnap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      cupSnapshots: cupSnapshots.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
      archives: archiveSnap.exists ? 1 : 0,
      rollovers: rolloverSnap.exists ? 1 : 0,
      history: historySnap.exists ? 1 : 0,
      archiveMatches: archiveMatchesSnap.size,
      matchPlayerEffects: matchEffectsSnap.size,
      matchRevenueReceipts: matchRevenueSnap.docs.filter(doc => doc.data()?.type === 'MATCH_REVENUE').length,
      cupMatchRevenueReceipts: cupMatchRevenueSnap.docs.filter(doc => doc.data()?.type === 'MATCH_REVENUE').length,
      matchConsequenceReceipts: leagueConsequenceSnap.size + cupConsequenceSnap.size,
      leagueSeasonRewardReceipts: leagueSeasonRewardSnap.docs.filter(doc => doc.data()?.type === 'LEAGUE_SEASON_REWARD').length,
      pyramidCupRewardReceipts: pyramidCupRewardSnap.docs.filter(doc =>
        ['PYRAMID_CUP_CHAMPION_REWARD', 'PYRAMID_CUP_FINALIST_REWARD'].includes(String(doc.data()?.type || ''))).length,
      slotHistoryEvents: slotHistorySnap.size,
      unclassifiedMatches,
      liveLocks: [rolloverLockSnap, calendarLockSnap].flatMap((snap, index) => {
        if (!snap.exists || Number(snap.data()?.expiresAtMs || 0) <= Date.now()) return [];
        return [index === 0 ? 'season_rollover_v1' : 'season_calendar_build_v1'];
      }),
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

/**
 * Explicitly confirmed Beta-only executor. GET remains a read-only preflight.
 * This endpoint is intentionally not invoked automatically by the application.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return respond(401, { success: false, error: 'UNAUTHORIZED', readOnly: false });
  }

  if (!isExpectedProject()) {
    return respond(403, { success: false, error: 'STAGING_PROJECT_MISMATCH', readOnly: false });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* invalid body handled below */ }
  if (body?.confirmation !== 'RESET_BETA_SEASON_ONE') {
    return respond(400, { success: false, error: 'EXPLICIT_RESET_CONFIRMATION_REQUIRED' });
  }

  try {
    const db = getAdminDb();
    const journalSnap = await db.collection('system_v1').doc('staging_fresh_season_one_reset_v1').get();
    let target: { seasonStart: string; nextSeasonStart: string };

    if (journalSnap.exists) {
      const journal = journalSnap.data() || {};
      if (journal.status === 'COMPLETED') {
        return respond(200, { success: true, alreadyCompleted: true, verification: journal.counts || {} });
      }
      if (!journal.target?.seasonStart || !journal.target?.nextSeasonStart) {
        return respond(409, { success: false, error: 'RESET_JOURNAL_TARGET_INVALID' });
      }
      target = journal.target;
    } else {
      const preflight = await GET(request);
      const result: any = await preflight.json();
      if (!result?.success || !result?.plan?.ready) {
        return respond(409, { success: false, error: 'RESET_PREFLIGHT_BLOCKED', preflight: result?.plan || result?.error });
      }
      target = {
        seasonStart: String(result.plan.target.seasonStart),
        nextSeasonStart: String(result.plan.target.nextSeasonStart),
      };
    }

    const result = await executeFreshSeasonOneReset(db, target);
    return respond(200, { readOnly: false, ...result });
  } catch (error: any) {
    const code = String(error?.message || error || 'RESET_EXECUTION_FAILED').slice(0, 160);
    const status = code.includes('ALREADY_RUNNING') ? 409 : 503;
    console.error('[STAGING SEASON ONE RESET EXECUTOR] Failed:', code);
    return respond(status, { success: false, readOnly: false, error: code });
  }
}
