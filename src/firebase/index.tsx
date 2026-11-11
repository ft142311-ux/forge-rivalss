import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { firebaseConfig } from "./config";

/**
 * Returns initialized Firebase services.
 * This function is isomorphic and can be called from both client and server (Server Actions).
 * 
 * Optimized for Firebase Studio / Cloud Workstations:
 * Forces Long Polling and disables Fetch Streams to ensure connectivity through proxies.
 */
function getSdks(app: FirebaseApp) {
  let firestore;
  try {
    // В облачных средах и проксированных окружениях принудительное включение 
    // long polling и отключение fetch streams значительно повышает стабильность.
    firestore = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch (e) {
    // Если Firestore уже инициализирован, просто получаем инстанс.
    // Обратите внимание: существующий инстанс может иметь другие настройки,
    // но в рамках этого приложения все вызовы идут через getSdks.
    firestore = getFirestore(app);
  }

  const auth = getAuth(app);
  const useLocalEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
  const isBrowser = typeof window !== 'undefined';

  if (useLocalEmulators && isBrowser) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099');
    } catch {
      // Auth emulator may already be connected.
    }

    try {
      connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    } catch {
      // Firestore emulator may already be connected.
    }
  }

  return {
    firebaseApp: app,
    auth,
    firestore,
  };
}

/**
 * Main initialization function.
 * Safe to call on the server in Next.js Server Actions.
 */
export function initializeFirebase() {
  if (getApps().length > 0) {
    return getSdks(getApp());
  }

  const app = initializeApp(firebaseConfig);
  return getSdks(app);
}

// Export all providers and hooks
export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
