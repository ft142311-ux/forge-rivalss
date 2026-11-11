import { NextResponse } from 'next/server';
import { recoverStuckSeason1MatchAction } from '@/app/actions/autonomous-cycle';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 60;

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  console.info('[TARGETED MATCH RECOVERY API] POST received');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isCronAuthorized(request, cronSecret)) {
    console.warn('[TARGETED MATCH RECOVERY API] unauthorized POST rejected');
    return new NextResponse('Unauthorized', { status: 401 });
  }
  console.info('[TARGETED MATCH RECOVERY API] authorization accepted; invoking recovery');
  try {
    const result = await recoverStuckSeason1MatchAction(cronSecret);
    console.info('[TARGETED MATCH RECOVERY API] recovery returned', { success: result.success, code: result.code, elapsedMs: Date.now() - requestStartedAt });
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error: any) {
    console.error('[TARGETED MATCH RECOVERY API] unhandled error', { error: String(error?.message || error), elapsedMs: Date.now() - requestStartedAt });
    return NextResponse.json(
      { success: false, code: 'RECOVERY_ENDPOINT_FAILED', error: String(error?.message || error) },
      { status: 500 }
    );
  }
}
