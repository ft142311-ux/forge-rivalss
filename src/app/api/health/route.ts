import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

/**
 * @fileOverview Health endpoint for the local and deployed app.
 * Keep responses uncached and avoid exposing backend exception details publicly.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getAdminDb();
    await db.collection('system_v1').doc('global_stats').get();

    return NextResponse.json({
      status: 'UP',
      services: { firestore: 'connected' },
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[HEALTH CHECK FAILED]:', error);
    return NextResponse.json({
      status: 'DOWN',
      error: 'FIRESTORE_UNAVAILABLE',
      timestamp: new Date().toISOString(),
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
