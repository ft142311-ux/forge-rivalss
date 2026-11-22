import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

/**
 * @fileOverview Системный мониторинг игрового мира.
 */

const LEAGUE_ID = 'ALPHA';
const CALENDAR_VERSION = 140;
const EXPECTED_GROUPS = 15;
const MATCHES_PER_GROUP = 56;

export async function GET() {
  try {
    const db = getAdminDb();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    const config = configSnap.data() || {};
    const activeSeason = Number(config.activeSeasonNumber || 1);

    const [tablesSnap, matchesSnap] = await Promise.all([
      db.collection('league_tables_v2')
        .where('season', '==', activeSeason)
        .where('leagueId', '==', LEAGUE_ID)
        .where('version', '==', CALENDAR_VERSION)
        .get(),
      db.collection('matches_v2')
        .where('season', '==', activeSeason)
        .where('leagueId', '==', LEAGUE_ID)
        .where('version', '==', CALENDAR_VERSION)
        .get(),
    ]);

    const tableGroups = new Set<string>();
    for (const doc of tablesSnap.docs) {
      const data = doc.data() || {};
      const level = Number(data.level || data.division || 0);
      const group = Number(data.group || data.groupId || 0);
      if (level >= 1 && level <= 4 && group >= 1 && group <= Math.pow(2, level - 1)) {
        tableGroups.add(`${level}:${group}`);
      }
    }

    const matchCounts = new Map<string, number>();
    for (const doc of matchesSnap.docs) {
      const data = doc.data() || {};
      const level = Number(data.level || data.division || 0);
      const group = Number(data.groupId || data.group || 0);
      if (level < 1 || level > 4 || group < 1 || group > Math.pow(2, level - 1)) continue;
      const key = `${level}:${group}`;
      matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
    }

    const groupsReady = [...tableGroups].filter(
      (key) => matchCounts.get(key) === MATCHES_PER_GROUP,
    ).length;
    const worldReady =
      config.worldReady === true &&
      tableGroups.size === EXPECTED_GROUPS &&
      groupsReady === EXPECTED_GROUPS;

    return NextResponse.json({
      status: 'OPERATIONAL',
      activeSeason,
      phase: config.phase || 'UNKNOWN',
      worldStatus: {
        ready: worldReady,
        groupsReady,
        totalGroups: EXPECTED_GROUPS,
        tables: tablesSnap.size,
        matches: matchesSnap.size,
        expectedMatches: EXPECTED_GROUPS * MATCHES_PER_GROUP,
      },
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: any) {
    return NextResponse.json({
      status: 'DEGRADED',
      error: error.message,
    }, { status: 500 });
  }
}
