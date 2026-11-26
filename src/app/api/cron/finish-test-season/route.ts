import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

/**
 * Disabled legacy test-world recovery endpoint.
 * Season transitions must run only through the canonical season orchestrator.
 * Keeping this route fail-closed prevents an old test-only S1 -> S2 mutation
 * from being triggered against a live or canonical world.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return NextResponse.json({
    success: false,
    action: 'LEGACY_SEASON_RECOVERY_DISABLED',
    reason: 'CANONICAL_ORCHESTRATOR_ONLY',
    writesStarted: false,
  }, { status: 410 });
}
