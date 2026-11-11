import { NextResponse } from 'next/server';
import { runGlobalEmergencyRepair } from '@/app/actions/fix-calendar';
import { isCronAuthorized } from '../cron-auth';

/**
 * @fileOverview Единственная точка входа для подготовки мира.
 * Защищена секретным токеном CRON_SECRET.
 */

export const maxDuration = 300; 

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const result = await runGlobalEmergencyRepair();
    return NextResponse.json({ 
      success: true, 
      timestamp: new Date().toISOString(),
      ...result 
    });
  } catch (error: any) {
    console.error('[CRON WORLD REPAIR ERROR]:', error);
    return NextResponse.json({ success: false, error: 'WORLD_REPAIR_FAILED' }, { status: 500 });
  }
}
