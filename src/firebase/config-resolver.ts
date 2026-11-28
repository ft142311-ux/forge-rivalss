export interface FirebaseWebConfigInput {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

const EXPECTED_HOSTED_PROJECT_ID = 'forge-rivals-beta';

export const LOCAL_FIREBASE_EMULATOR_CONFIG: FirebaseWebConfig = {
  apiKey: 'local-emulator-api-key',
  authDomain: 'demo-forge-rivals.firebaseapp.com',
  projectId: 'demo-forge-rivals',
  storageBucket: 'demo-forge-rivals.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:forgerivalslocal',
  measurementId: '',
};

const REQUIRED_HOSTED_FIELDS = [
  'apiKey',
  'authDomain',
  'projectId',
  'messagingSenderId',
  'appId',
] as const;

function normalizedValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve Firebase configuration without mixing hosted Beta values with the
 * disposable emulator project's defaults. Non-emulator clients may connect
 * only to the explicitly configured forge-rivals-beta Web App.
 */
export function resolveFirebaseWebConfig(
  envConfig: FirebaseWebConfigInput,
  useEmulators: boolean,
): FirebaseWebConfig {
  if (useEmulators) return { ...LOCAL_FIREBASE_EMULATOR_CONFIG };

  const missing = REQUIRED_HOSTED_FIELDS.filter((field) => !normalizedValue(envConfig[field]));
  if (missing.length > 0) {
    throw new Error(
      'Missing Firebase Web configuration for forge-rivals-beta. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID and NEXT_PUBLIC_FIREBASE_APP_ID.',
    );
  }

  const projectId = normalizedValue(envConfig.projectId);
  if (projectId !== EXPECTED_HOSTED_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_MISMATCH: expected forge-rivals-beta.');
  }

  const config: FirebaseWebConfig = {
    apiKey: normalizedValue(envConfig.apiKey),
    authDomain: normalizedValue(envConfig.authDomain),
    projectId,
    messagingSenderId: normalizedValue(envConfig.messagingSenderId),
    appId: normalizedValue(envConfig.appId),
  };

  // Storage is optional for Firebase App initialization. If supplied, it must
  // come from Beta's own environment; never inherit the local demo bucket.
  const storageBucket = normalizedValue(envConfig.storageBucket);
  if (storageBucket) config.storageBucket = storageBucket;

  const measurementId = normalizedValue(envConfig.measurementId);
  if (measurementId) config.measurementId = measurementId;

  return config;
}
