import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin SDK initialization.
 *
 * Local mode connects only to the Firebase Emulator Suite.
 * Hosted mode fails closed unless the browser and server identify the same
 * explicit Firebase project and Admin credentials belong to that project.
 */

function getFirebaseProjectId(useEmulators: boolean): string {
  if (useEmulators) {
    return (
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      'demo-forge-rivals'
    );
  }

  const serverProjectId =
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!serverProjectId) {
    throw new Error('GCLOUD_PROJECT is required for hosted Firebase Admin access');
  }

  if (!clientProjectId) {
    throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is required for hosted Firebase access');
  }

  if (serverProjectId !== clientProjectId) {
    throw new Error('Firebase server and browser project IDs do not match');
  }

  return serverProjectId;
}

function getOrInitializeAdminApp(useEmulators: boolean): App {
  const projectId = getFirebaseProjectId(useEmulators);
  const existing = getApps()[0];

  if (existing) {
    if (existing.options.projectId && existing.options.projectId !== projectId) {
      throw new Error('Existing Firebase Admin app belongs to a different project');
    }
    return existing;
  }

  if (useEmulators) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST =
      process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

    return initializeApp({ projectId });
  }

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SDK;
  if (serviceAccountJson) {
    let serviceAccount: Record<string, unknown>;

    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error('FIREBASE_ADMIN_SDK must contain valid JSON');
    }

    if (
      typeof serviceAccount.project_id !== 'string' ||
      serviceAccount.project_id !== projectId
    ) {
      throw new Error('Firebase Admin service-account project_id must match the configured Firebase project');
    }

    return initializeApp({
      credential: cert(serviceAccount as any),
      projectId,
    });
  }

  if (process.env.FIREBASE_ADMIN_USE_ADC === 'true') {
    return initializeApp({ projectId });
  }

  throw new Error(
    'Firebase Admin credentials are missing. Configure FIREBASE_ADMIN_SDK or explicitly enable FIREBASE_ADMIN_USE_ADC.'
  );
}

export function getAdminDb(): Firestore {
  try {
    const useEmulators =
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';

    const adminApp = getOrInitializeAdminApp(useEmulators);
    return getFirestore(adminApp);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown initialization error';
    console.error('[FIREBASE ADMIN] Initialization Failure:', message);
    throw new Error('SERVER_DATABASE_UNAVAILABLE');
  }
}
