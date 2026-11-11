import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

/**
 * @fileOverview Health endpoint for the local and deployed app.
 */
export async function GET() {
  try {
    const db = getAdminDb();
    await db.collection('system_v1').doc('global_stats').get();

    return NextResponse.json({
      status: 'UP',
      services: { firestore: 'connected' },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[HEALTH CHECK FAILED]:', error.message);
    return NextResponse.json({
      status: 'DOWN',
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
