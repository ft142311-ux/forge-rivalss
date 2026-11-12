import { NextResponse } from 'next/server';
import { reconstructMissingSeasonTwoAndPrepareSeasonThree } from '@/app/actions/season-recovery';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

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
