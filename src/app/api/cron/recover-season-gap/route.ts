import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { recoverIncompleteSeasonTwo } from '@/app/actions/season-recovery';
import { ensureSeasonCalendar, publishPreparedSeason } from '@/app/actions/season-calendar';
import { cronResultStatus } from '../cron-result';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** Explicit, authenticated recovery path. It prepares/publishes S3 only; it does not simulate overdue fixtures. */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });
  try {
    const db = getAdminDb();
    const configRef = db.doc('system_v1/season_config');
    const configSnap = await configRef.get();
    const config = configSnap.data() || {};
    if (Number(config.activeSeasonNumber || 1) === 3 && config.worldReady === true) {
      return NextResponse.json({ success: true, alreadyActive: true, activeSeasonNumber: 3 });
    }
    if (Number(config.activeSeasonNumber || 1) !== 1) return NextResponse.json({ success: false, reason: 'UNEXPECTED_ACTIVE_SEASON', writesStarted: false }, { status: 409 });
    const recovery = await recoverIncompleteSeasonTwo();
    if (!recovery.success) return NextResponse.json({ success: false, recovery, writesStarted: recovery.writesStarted === true }, { status: 409 });
    const calendar: any = await ensureSeasonCalendar(3);
    if (calendar?.success !== true || calendar?.seasonNumber !== 3 || calendar?.prepared !== true) {
      return NextResponse.json({ success: false, recovery, calendar, writesStarted: true }, { status: 409 });
    }
    const publication = await publishPreparedSeason();
    if (publication?.success !== true) return NextResponse.json({ success: false, recovery, calendar, publication, writesStarted: true }, { status: 409 });
    return NextResponse.json({ success: true, recovery, calendar, publication, activeSeasonNumber: 3 }, { status: cronResultStatus({ success: true }) });
  } catch (error: any) {
    console.error('[SEASON GAP RECOVERY]:', error?.message || 'UNKNOWN_ERROR');
    return NextResponse.json({ success: false, reason: 'SEASON_GAP_RECOVERY_FAILED' }, { status: 500 });
  }
}
