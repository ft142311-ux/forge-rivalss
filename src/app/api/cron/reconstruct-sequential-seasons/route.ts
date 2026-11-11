import { NextResponse } from 'next/server';
import { reconstructMissingSeasonTwoAndPrepareSeasonThree } from '@/app/actions/season-recovery';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    const result = await reconstructMissingSeasonTwoAndPrepareSeasonThree();
    return NextResponse.json(result, { status: 'complete' in result && result.complete === false ? 202 : result.success === true ? 200 : 409 });
  } catch (error: any) {
    console.error('[SEQUENTIAL SEASON RECONSTRUCTION]:', error?.message || 'UNKNOWN_ERROR');
    return NextResponse.json({ success: false, reason: 'SEQUENTIAL_RECONSTRUCTION_FAILED', error: String(error?.message || error) }, { status: 500 });
  }
}
