import { NextRequest, NextResponse } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { ensureSeasonCalendar } from '@/app/actions/season-calendar';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EXPECTED_PROJECT = 'forge-rivals-beta';
const LEAGUE_ID = 'ALPHA';
const SEASON = 1;
const VERSION = 140;
const EXPECTED_GROUPS = 15;
const EXPECTED_SLOTS = 120;
const EXPECTED_MATCHES = 840;
const EXPECTED_PARTICIPANTS = 120;

const GUARDED_COLLECTIONS = [
  'system_v1',
  'league_tables_v2',
  'league_slots_v1',
  'matches_v2',
  'players_v14',
  'league_slot_history_v1',
  'league_season_archives_v1',
  'league_season_rollovers_v1',
  'cup_pyramid_v1',
  'cup_matches',
  'cup_participant_snapshots_v1',
  'security_audit_v1',
];

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return response(401, { success: false, error: 'UNAUTHORIZED' });
  }

  const configuredProject =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '';
  if (configuredProject !== EXPECTED_PROJECT) {
    return response(403, {
      success: false,
      error: 'STAGING_PROJECT_MISMATCH',
      expectedProject: EXPECTED_PROJECT,
      configuredProject: configuredProject || null,
      writesStarted: false,
    });
  }

  try {
    const db = getAdminDb();
    const configRef = db.collection('system_v1').doc('season_config');
    const configSnap = await configRef.get();

    if (configSnap.exists) {
      const config = configSnap.data() || {};
      if (config.worldReady === true && Number(config.activeSeasonNumber) === SEASON) {
        const verification = await verifyWorld(db);
        return response(verification.ready ? 200 : 409, {
          success: verification.ready,
          action: 'EXISTING_WORLD_VERIFICATION',
          ...verification,
          writesStarted: false,
        });
      }
      return response(409, {
        success: false,
        error: 'SEASON_CONFIG_ALREADY_EXISTS',
        phase: config.phase || null,
        activeSeasonNumber: config.activeSeasonNumber || null,
        worldReady: config.worldReady === true,
        writesStarted: false,
      });
    }

    // Never use the calendar builder as a repair mechanism. Reject any existing
    // game, history, rollover, or system document before its first write.
    const snapshots = await Promise.all(
      GUARDED_COLLECTIONS.map((name) => db.collection(name).limit(1).get()),
    );
    const populated = snapshots
      .map((snapshot, index) => ({
        collection: GUARDED_COLLECTIONS[index],
        hasDocuments: !snapshot.empty,
      }))
      .filter((item) => item.hasDocuments);

    if (populated.length > 0) {
      return response(409, {
        success: false,
        error: 'STAGING_DATABASE_NOT_PRISTINE',
        populatedCollections: populated.map((item) => item.collection),
        writesStarted: false,
      });
    }

    // The builder uses its own fenced lease and bounded commits. The broad
    // season orchestrator and emergency-repair endpoint are intentionally not used.
    const build = await ensureSeasonCalendar(SEASON);
    if ((build as any)?.success !== true) {
      return response(409, {
        success: false,
        error: 'SEASON_CALENDAR_BUILD_BLOCKED',
        build,
        writesStarted: (build as any)?.writesStarted === true,
      });
    }

    const verification = await verifyWorld(db);
    return response(verification.ready ? 200 : 500, {
      success: verification.ready,
      action: 'STAGING_SEASON_ONE_BOOTSTRAP',
      build,
      ...verification,
      writesStarted: true,
    });
  } catch (error) {
    console.error('[STAGING WORLD BOOTSTRAP] Failed:', error);
    return response(500, {
      success: false,
      error: 'STAGING_WORLD_BOOTSTRAP_FAILED',
      writesStarted: true,
    });
  }
}

async function verifyWorld(db: Firestore) {
  const [configSnap, tablesSnap, slotsSnap, matchesSnap] = await Promise.all([
    db.collection('system_v1').doc('season_config').get(),
    db.collection('league_tables_v2')
      .where('season', '==', SEASON)
      .where('version', '==', VERSION)
      .get(),
    db.collection('league_slots_v1')
      .where('season', '==', SEASON)
      .where('leagueId', '==', LEAGUE_ID)
      .get(),
    db.collection('matches_v2')
      .where('season', '==', SEASON)
      .where('version', '==', VERSION)
      .get(),
  ]);

  const config = configSnap.exists ? configSnap.data() || {} : {};
  const groups = new Set(
    tablesSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return `${Number(data.level)}:${Number(data.group)}`;
    }),
  );
  // League standings, not the bot count, define the 120 canonical
  // participants. Registration legitimately deletes the replaced bot profile
  // after transferring its standings row to the human manager's UID.
  const participantIds: string[] = [];
  let standingsValid = tablesSnap.size === EXPECTED_GROUPS;
  for (const tableDoc of tablesSnap.docs) {
    const stats = tableDoc.data()?.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      standingsValid = false;
      continue;
    }
    const rows = Object.entries(stats as Record<string, any>);
    if (rows.length !== 8) standingsValid = false;
    const ranks = new Set<number>();
    for (const [participantId, row] of rows) {
      const rank = Number(row?.rank);
      if (!participantId || (row?.id != null && row.id !== participantId) ||
          !Number.isInteger(rank) || rank < 1 || rank > 8 || ranks.has(rank)) {
        standingsValid = false;
      }
      ranks.add(rank);
      participantIds.push(participantId);
    }
    if (ranks.size !== 8) standingsValid = false;
  }
  const uniqueParticipantIds = [...new Set(participantIds)];
  if (uniqueParticipantIds.length !== EXPECTED_PARTICIPANTS) standingsValid = false;

  const participantProfiles = standingsValid && uniqueParticipantIds.length === EXPECTED_PARTICIPANTS
    ? await db.getAll(...uniqueParticipantIds.map((id) => db.collection('players_v14').doc(id)))
    : [];
  const validProfiles = participantProfiles.filter((profile, index) =>
    profile.exists && profile.data()?.id === uniqueParticipantIds[index]
  );
  const botProfiles = participantProfiles.filter((profile, index) =>
    profile.exists && profile.data()?.id === uniqueParticipantIds[index] &&
    profile.data()?.isBot === true
  );
  // Verify the persisted Pyramid Cup independently of the calendar builder.
  // The builder's internal checks protect creation; this postflight protects the
  // bootstrap response from reporting READY if cup documents/snapshots are absent.
  const cupId = 'cup_s1_lALPHA';
  const [cupSnap, cupMatchesSnap, cupSnapshotsSnap] = await Promise.all([
    db.collection('cup_pyramid_v1').doc(cupId).get(),
    db.collection('cup_matches').where('cupId', '==', cupId).get(),
    db.collection('cup_participant_snapshots_v1').doc(cupId).collection('teams').get(),
  ]);
  const cup = cupSnap.exists ? cupSnap.data() || {} : {};
  const cupParticipants = Array.isArray(cup.participants) ? cup.participants : [];
  const cupFirstRound = Array.isArray(cup.rounds?.r1) ? cup.rounds.r1 : [];
  const cupFixtureDocs = cupMatchesSnap.docs;
  const cupFirstRoundValid =
    cupFirstRound.length === 56 &&
    cupFirstRound.every((pairing: any) =>
      pairing?.home?.id && pairing?.away?.id &&
      pairing?.status !== 'bye'
    );
  const cupFixturesValid =
    cupFixtureDocs.length === 56 &&
    cupFixtureDocs.every((doc) => {
      const fixture = doc.data() || {};
      return fixture.cupId === cupId &&
        Number(fixture.season) === SEASON &&
        Number(fixture.cupRound) === 1 &&
        Number(fixture.bestOf) === 1 &&
        fixture.type === 'cup' &&
        Boolean(fixture.homeId) && Boolean(fixture.awayId);
    });
  const cupReady =
    cupSnap.exists &&
    Number(cup.season) === SEASON &&
    cup.name === 'Кубок Пирамиды' &&
    cup.status === 'active' &&
    cup.format === 'D1_REST_OPENING_ROUND' &&
    Number(cup.totalRounds) === 7 &&
    Number(cup.totalParticipants) === EXPECTED_PARTICIPANTS &&
    Number(cup.totalMatches) === 119 &&
    Number(cup.preliminaryMatches) === 56 &&
    Number(cup.byeCount) === 0 &&
    Number(cup.openingRoundRestCount) === 8 &&
    Array.isArray(cup.openingRoundRestTeams) &&
    cup.openingRoundRestTeams.length === 8 &&
    cupParticipants.length === EXPECTED_PARTICIPANTS &&
    new Set(cupParticipants.map((team: any) => String(team?.id || ''))).size === EXPECTED_PARTICIPANTS &&
    cupFirstRoundValid &&
    cupFixturesValid &&
    cupSnapshotsSnap.size === EXPECTED_PARTICIPANTS &&
    config.pyramidCupRequired === true &&
    config.pyramidCupReady === true &&
    Number(config.pyramidCupReadySeasonNumber) === SEASON;
  const counts = {
    groups: groups.size,
    tables: tablesSnap.size,
    slots: slotsSnap.size,
    matches: matchesSnap.size,
    participants: uniqueParticipantIds.length,
    participantProfiles: validProfiles.length,
    bots: botProfiles.length,
    cupExists: cupSnap.exists,
    cupParticipants: cupParticipants.length,
    cupMatches: cupFixtureDocs.length,
    cupFirstRoundMatches: cupFirstRound.length,
    cupParticipantSnapshots: cupSnapshotsSnap.size,
  };
  const ready =
    configSnap.exists &&
    config.worldReady === true &&
    Number(config.activeSeasonNumber) === SEASON &&
    String(config.phase || '').toUpperCase() === 'REGULAR_SEASON' &&
    counts.groups === EXPECTED_GROUPS &&
    counts.tables === EXPECTED_GROUPS &&
    counts.slots === EXPECTED_SLOTS &&
    counts.matches === EXPECTED_MATCHES &&
    standingsValid &&
    counts.participants === EXPECTED_PARTICIPANTS &&
    counts.participantProfiles === EXPECTED_PARTICIPANTS &&
    cupReady;

  return {
    ready,
    worldReady: config.worldReady === true,
    activeSeasonNumber: Number(config.activeSeasonNumber || 0),
    phase: config.phase || null,
    counts,
    expected: {
      groups: EXPECTED_GROUPS,
      tables: EXPECTED_GROUPS,
      slots: EXPECTED_SLOTS,
      matches: EXPECTED_MATCHES,
      participants: EXPECTED_PARTICIPANTS,
      participantProfiles: EXPECTED_PARTICIPANTS,
      cupParticipants: EXPECTED_PARTICIPANTS,
      cupMatches: 56,
      cupParticipantSnapshots: EXPECTED_PARTICIPANTS,
      cupTotalMatches: 119,
      cupRounds: 7,
      cupFinalBestOf: 3,
    },
    cupReady,
  };
}
