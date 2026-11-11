import { NextResponse } from 'next/server';
import { completeRecoveredSeasonTwo } from '@/app/actions/season-recovery';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** Protected one-shot recovery. It never changes the published active season. */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    const result = await completeRecoveredSeasonTwo();
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error: any) {
    console.error('[SEASON 2 RECOVERY COMPLETION]:', error?.message || 'UNKNOWN_ERROR');
    return NextResponse.json({ success: false, reason: 'SEASON_2_RECOVERY_COMPLETION_FAILED' }, { status: 500 });
  }
}
