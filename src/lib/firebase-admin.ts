import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin SDK initialization.
 *
 * Local mode connects only to the Firebase Emulator Suite.
 * Hosted mode requires an explicit service-account secret unless the runtime
 * is deliberately configured to use Google Application Default Credentials.
 */

const FIREBASE_PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  'demo-forge-rivals';

function getOrInitializeAdminApp(useEmulators: boolean): App {
  const existing = getApps()[0];
  if (existing) return existing;

  if (useEmulators) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST =
      process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

    return initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SDK;
  if (serviceAccountJson) {
    let serviceAccount: Record<string, unknown>;

    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error('FIREBASE_ADMIN_SDK must contain valid JSON');
    }

    const credentialProjectId = serviceAccount.project_id;
    if (
      typeof credentialProjectId === 'string' &&
      credentialProjectId !== FIREBASE_PROJECT_ID
    ) {
      throw new Error('Firebase Admin credential project does not match configured project');
    }

    return initializeApp({
      credential: cert(serviceAccount as any),
      projectId: FIREBASE_PROJECT_ID,
    });
  }

  if (process.env.FIREBASE_ADMIN_USE_ADC === 'true') {
    return initializeApp({ projectId: FIREBASE_PROJECT_ID });
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
