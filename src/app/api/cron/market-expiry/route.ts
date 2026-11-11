import { NextResponse } from 'next/server';
import { runTransferMarketExpirySweep } from '@/app/actions/autonomous-cycle';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** P2 transfer-market expiry sweep. Run every 5-15 minutes. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const result = await runTransferMarketExpirySweep();
    if (result.success === false) {
      return NextResponse.json({ ...result, timestamp: new Date().toISOString() }, { status: 503 });
    }
    return NextResponse.json({ ...result, success: true, timestamp: new Date().toISOString() });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'MARKET_EXPIRY_FAILED' },
      { status: 500 },
    );
  }
}
