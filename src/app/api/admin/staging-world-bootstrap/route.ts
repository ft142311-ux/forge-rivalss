import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ensureSeasonCalendar } from '@/app/actions/season-calendar';
import { isCronAuthorized } from '@/app/api/cron/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const EXPECTED_PROJECT = 'forge-rivalstest';
const LEAGUE_ID = 'ALPHA';
const SEASON = 1;
const VERSION = 140;
const EXPECTED_GROUPS = 15;
const EXPECTED_SLOTS = 120;
const EXPECTED_MATCHES = 840;
const EXPECTED_BOTS = 120;

// These collections are owned by the canonical season bootstrap. Any existing
// document means this endpoint must stop rather than attempt a repair.
const GUARDED_COLLECTIONS = [
  'system_v1',
  'league_tables_v2',
  'league_slots_v1',
  'matches_v2',
  'players_v14',
  'league_slot_history_v1',
  'league_season_archives_v1',
  'league_season_rollovers_v1',
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

  // This endpoint is deliberately incapable of running against local,
  // production, or any Firebase project other than the dedicated staging DB.
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

    // Strict read-only preflight. We also reject stale locks and history/rollover
    // artifacts; ensureSeasonCalendar must never be used as a generic repair tool.
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

    // The calendar builder owns its fenced build lock and performs bounded,
    // idempotent writes. Do not call the broad season orchestrator or emergency
    // repair endpoint here.
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

async function verifyWorld(db: FirebaseFirestore.Firestore) {
  const [configSnap, tablesSnap, slotsSnap, matchesSnap, botsSnap] = await Promise.all([
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
    db.collection('players_v14').where('isBot', '==', true).get(),
  ]);

  const config = configSnap.exists ? configSnap.data() || {} : {};
  const groups = new Set(
    tablesSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return `${Number(data.level)}:${Number(data.group)}`;
    }),
  );
  const counts = {
    groups: groups.size,
    tables: tablesSnap.size,
    slots: slotsSnap.size,
    matches: matchesSnap.size,
    bots: botsSnap.size,
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
    counts.bots >= EXPECTED_BOTS;

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
      bots: EXPECTED_BOTS,
    },
  };
}
