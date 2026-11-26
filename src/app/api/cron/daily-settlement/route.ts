import { NextResponse } from 'next/server';
import { resolveDailyMatches } from '@/app/actions/autonomous-cycle';
import { runFoundationDailyCycle } from '@/app/actions/foundation-cycle';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** P2 daily settlement. Scheduler target: 00:00 MSK every day. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });
  try {
    const matches = await resolveDailyMatches();
    const foundation = await runFoundationDailyCycle(process.env.CRON_SECRET || '');
    const success = matches?.success !== false && foundation?.success !== false;
    return NextResponse.json({ success, timestamp: new Date().toISOString(), matches, foundation }, { status: success ? 200 : 207 });
  }
  catch (error: any) { console.error('[CRON DAILY SETTLEMENT ERROR]', error); return NextResponse.json({ success: false, error: 'DAILY_SETTLEMENT_FAILED' }, { status: 500 }); }
}
