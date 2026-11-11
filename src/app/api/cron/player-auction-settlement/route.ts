import { NextResponse } from 'next/server';
import { runPlayerAuctionSettlementSweep } from '@/app/actions/autonomous-cycle';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/** Finalizes expired player auctions. Run every 1-5 minutes. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const result = await runPlayerAuctionSettlementSweep();
    if (result.success === false) {
      return NextResponse.json({ ...result, timestamp: new Date().toISOString() }, { status: 503 });
    }
    return NextResponse.json({ ...result, success: true, timestamp: new Date().toISOString() });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'PLAYER_AUCTION_SETTLEMENT_FAILED' },
      { status: 500 },
    );
  }
}
