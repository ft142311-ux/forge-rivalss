/**
 * Firebase Web SDK configuration.
 *
 * Local integration tests explicitly opt into the disposable demo emulator.
 * Every non-emulator runtime must provide the Firebase Web App configuration
 * for forge-rivals-beta; hosted values are never merged with demo defaults.
 */

import { resolveFirebaseWebConfig } from './config-resolver';

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';

const envConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const firebaseConfig = resolveFirebaseWebConfig(envConfig, useEmulators);
