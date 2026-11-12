import { NextResponse } from 'next/server';
import { completeRecoveredSeasonTwo } from '@/app/actions/season-recovery';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** Protected one-shot recovery. It never changes the published active season. */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return NextResponse.json({
    success: false,
    action: 'LEGACY_SEASON_RECOVERY_DISABLED',
    reason: 'SEASON_1_TO_2_ONLY_RECOVERY_SCOPE',
    writesStarted: false,
  }, { status: 410 });
}
