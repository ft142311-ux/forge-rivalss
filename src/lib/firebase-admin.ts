import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin SDK initialization.
 *
 * In local emulator mode we explicitly provide the Firebase project ID.
 * This is required by Admin Auth when verifyIdToken() is used.
 */

const FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'demo-forge-rivals';

export function getAdminDb(): Firestore {
  try {
    const useEmulators =
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';

    if (useEmulators) {
      process.env.FIRESTORE_EMULATOR_HOST =
        process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

      process.env.FIREBASE_AUTH_EMULATOR_HOST =
        process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    }

    let adminApp: App;

    if (getApps().length === 0) {
      const serviceAccountJson = process.env.FIREBASE_ADMIN_SDK;

      if (serviceAccountJson && serviceAccountJson.trim().startsWith('{')) {
        adminApp = initializeApp({
          credential: cert(JSON.parse(serviceAccountJson)),
          projectId: useEmulators
            ? FIREBASE_PROJECT_ID
            : undefined,
        });
      } else if (useEmulators) {
        // Local Firebase Emulator Suite.
        // No production service account is required.
        adminApp = initializeApp({
          projectId: FIREBASE_PROJECT_ID,
        });
      } else {
        // Firebase App Hosting / Cloud Functions / ADC.
        adminApp = initializeApp();
      }
    } else {
      adminApp = getApps()[0];
    }

    return getFirestore(adminApp);
  } catch (error: any) {
    console.error(
      '[FIREBASE ADMIN] Initialization Failure:',
      error?.message || error
    );
    throw new Error('SERVER_DATABASE_UNAVAILABLE');
  }
}
