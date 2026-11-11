import { NextResponse } from 'next/server';
import { runSeasonOrchestrator } from '@/app/actions/season-cycle';
import { cronResultStatus } from '../cron-result';
import { isCronAuthorized } from '../cron-auth';

/**
 * @fileOverview Единая точка входа для автономного управления миром.
 * Запуск: каждые 5 минут.
 */

export const maxDuration = 300; 

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const result: any = await runSeasonOrchestrator();
    const blockedActions = new Set(['ERROR', 'WORLD_NOT_READY', 'WORLD_BUILDING', 'WAITING_FOR_SEASON_RESULTS']);
    const success = result?.success === false
      ? false
      : !blockedActions.has(String(result?.action || ''))
        && result?.worldReady !== false
        && result?.matchSettlement?.success !== false
        && result?.publication?.success !== false;
    const response = { ...result, success, timestamp: new Date().toISOString() };
    return NextResponse.json(response, { status: cronResultStatus(response) });
  } catch (error: any) {
    console.error('[CRON ORCHESTRATOR ERROR]:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
