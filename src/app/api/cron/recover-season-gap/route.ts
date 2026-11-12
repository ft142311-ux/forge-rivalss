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
  return NextResponse.json({
    success: false,
    action: 'LEGACY_SEASON_RECOVERY_DISABLED',
    reason: 'SEASON_1_TO_2_ONLY_RECOVERY_SCOPE',
    writesStarted: false,
  }, { status: 410 });
}
