import { NextResponse } from 'next/server';
import { runTournamentCycle } from '@/app/actions/tournament-system';
import { runPyramidCupCycle } from '@/app/actions/cup-engine';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isCronAuthorized(request, cronSecret)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    const result = await runTournamentCycle(cronSecret);
    const pyramidCup = await runPyramidCupCycle();
    const pyramidCupFailed = 'success' in pyramidCup && pyramidCup.success === false;
    const success = result?.success !== false && !pyramidCupFailed;
    return NextResponse.json(
      { timestamp: new Date().toISOString(), ...result, pyramidCup, success },
      { status: success ? 200 : 207 },
    );
  } catch (e: any) {
    console.error('[CRON TOURNAMENTS ERROR]', e);
    return NextResponse.json({ success: false, error: 'TOURNAMENT_CYCLE_FAILED' }, { status: 500 });
  }
}
