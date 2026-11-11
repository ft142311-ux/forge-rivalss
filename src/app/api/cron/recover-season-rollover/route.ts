import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { prepareSeasonRollover } from '@/app/actions/season-rollover';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** One-purpose recovery endpoint. Does not run daily settlement, tournaments, or calendar activation. */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const db = getAdminDb();
    const configSnap = await db.collection('system_v1').doc('season_config').get();
    if (!configSnap.exists) {
      return NextResponse.json({ success: false, action: 'CONFIG_MISSING' }, { status: 409 });
    }
    const config = configSnap.data() || {};
    const sourceSeason = Number(config.activeSeasonNumber);
    const targetSeason = sourceSeason + 1;
    if (!Number.isInteger(sourceSeason) || sourceSeason !== 1 || config.worldReady !== true) {
      return NextResponse.json({ success: false, action: 'PRECONDITION_FAILED', sourceSeason, worldReady: config.worldReady }, { status: 409 });
    }

    // Season 1 recovery repairs only deterministic fixture-proven drift; it does not initialize Season 2.
    const result = await prepareSeasonRollover(db, sourceSeason, targetSeason, true);
    return NextResponse.json({ success: result.ready === true, action: result.ready ? 'ROLLOVER_READY' : 'ROLLOVER_BLOCKED', sourceSeason, targetSeason, result, timestamp: new Date().toISOString() }, { status: result.ready ? 200 : 409 });
  } catch (error: any) {
    console.error('[SEASON ROLLOVER RECOVERY]', error);
    return NextResponse.json({ success: false, action: 'ERROR', error: 'SEASON_ROLLOVER_RECOVERY_FAILED' }, { status: 500 });
  }
}
