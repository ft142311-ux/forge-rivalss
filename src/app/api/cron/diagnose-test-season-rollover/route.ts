import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { diagnoseSeasonRolloverPreflight } from '@/app/actions/season-rollover';
import { isCronAuthorized } from '../cron-auth';

/**
 * Read-only diagnostic endpoint for the disposable Season 1 test world.
 * It never starts the rollover or changes Firestore documents.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // This diagnostic belongs only to the disposable local Season 1 test world.
  // Never allow it to inspect a shared staging or Production Firestore project.
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  if (!/^(127\\.0\\.0\\.1|localhost):[0-9]+$/.test(emulatorHost) || projectId !== 'demo-forge-rivals') {
    return NextResponse.json({
      success: false,
      readOnly: true,
      action: 'LOCAL_EMULATOR_ONLY',
      writesStarted: false,
    }, { status: 404 });
  }

  try {
    const db = getAdminDb();
    const diagnostic = await diagnoseSeasonRolloverPreflight(db, 1, true);
    return NextResponse.json({
      success: true,
      readOnly: true,
      sourceSeason: 1,
      targetSeason: 2,
      diagnostic,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      readOnly: true,
      action: 'SEASON_ROLLOVER_DIAGNOSTIC_FAILED',
      error: String(error?.message || error),
    }, { status: 500 });
  }
}
