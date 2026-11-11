import { NextResponse } from 'next/server';
import { finishTestSeason1AndPrepareSeason2 } from '@/app/actions/season-cycle';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    const result = await finishTestSeason1AndPrepareSeason2();
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      action: 'TEST_SEASON_RECOVERY_FAILED',
      error: String(error?.message || error),
    }, { status: 500 });
  }
}