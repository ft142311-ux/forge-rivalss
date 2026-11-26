import { NextResponse } from 'next/server';
import { resolveDueAssociationMatches, resolveDueFriendlyMatches } from '@/app/actions/friendly-matchmaking';
import { isCronAuthorized } from '../cron-auth';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const [friendly, association] = await Promise.all([
      resolveDueFriendlyMatches(process.env.CRON_SECRET || ''),
      resolveDueAssociationMatches(process.env.CRON_SECRET || ''),
    ]);
    const success = friendly.success && association.success;
    return NextResponse.json({ success, resolved: friendly.resolved + association.resolved, friendly, association, timestamp: new Date().toISOString() }, { status: success ? 200 : 207 });
  } catch (error: any) {
    console.error('[CRON FRIENDLY MATCH ERROR]:', error);
    return NextResponse.json({ success: false, error: 'FRIENDLY_MATCH_RESOLUTION_FAILED' }, { status: 500 });
  }
}
