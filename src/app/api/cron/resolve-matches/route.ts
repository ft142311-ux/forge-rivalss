import { NextResponse } from 'next/server';
import { resolveDailyMatches } from '@/app/actions/autonomous-cycle';
import { resolveDueFriendlyMatches } from '@/app/actions/friendly-matchmaking';
import { runTournamentCycle } from '@/app/actions/tournament-system';
import { ensureSeasonCalendar } from '@/app/actions/season-calendar';
import { calendarBlockedResult, isCalendarReady } from '@/app/actions/season-calendar-gate';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

async function runTimedStage<T>(stage: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  console.info(`[CRON TIMING] ${stage} started`);
  try {
    const result = await task();
    console.info(`[CRON TIMING] ${stage} completed in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    console.error(`[CRON TIMING] ${stage} failed after ${Date.now() - startedAt}ms`, error);
    throw error;
  }
}

export async function GET(request: Request) {
  const requestStartedAt = Date.now();
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !isCronAuthorized(request, cronSecret)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  console.info('[CRON TIMING] resolve-matches request started');
  try {
    const calendar = await runTimedStage('ensureSeasonCalendar', () => ensureSeasonCalendar());
    if (!isCalendarReady(calendar)) {
      return NextResponse.json({
        ...calendarBlockedResult(calendar),
        timestamp: new Date().toISOString(),
      }, { status: 409 });
    }

    // Keep the existing concurrency model; measure each workload independently.
    const [result, friendlyResult, tournamentResult] = await Promise.all([
      runTimedStage('resolveDailyMatches', () => resolveDailyMatches()),
      runTimedStage('resolveDueFriendlyMatches', () => resolveDueFriendlyMatches(cronSecret)),
      runTimedStage('runTournamentCycle', () => runTournamentCycle(cronSecret)),
    ]);

    const totalMs = Date.now() - requestStartedAt;
    console.info(`[CRON TIMING] resolve-matches completed in ${totalMs}ms`);
    const success = result?.success !== false && friendlyResult?.success !== false && tournamentResult?.success !== false;
    return NextResponse.json({
      ...result,
      success,
      timestamp: new Date().toISOString(),
      friendly: friendlyResult,
      tournaments: tournamentResult,
      calendar,
      diagnostics: { totalMs },
    }, { status: success ? 200 : 207 });
  } catch (error: any) {
    const totalMs = Date.now() - requestStartedAt;
    console.error(`[CRON MATCH RESOLVE ERROR] failed after ${totalMs}ms:`, error?.stack || error?.message || error);
    return NextResponse.json({ success: false, error: 'MATCH_RESOLUTION_FAILED', diagnostics: { totalMs } }, { status: 500 });
  }
}
