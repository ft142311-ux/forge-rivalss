import { NextResponse } from 'next/server';
import { runFoundationDailyCycle } from '@/app/actions/foundation-cycle';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });
  try {
    const result = await runFoundationDailyCycle(process.env.CRON_SECRET || '');
    return NextResponse.json(result, { status: result.success ? 200 : 207 });
  }
  catch (error: any) { console.error('[CRON FOUNDATION CYCLE ERROR]', error); return NextResponse.json({ success: false, error: 'FOUNDATION_CYCLE_FAILED' }, { status: 500 }); }
}
