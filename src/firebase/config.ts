/**
 * Firebase Web SDK configuration.
 *
 * Local development keeps the demo-forge-rivals defaults.
 * Hosted environments must provide the Firebase Web App values explicitly
 * through NEXT_PUBLIC_* environment variables.
 */

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
const isProductionBuild = process.env.NODE_ENV === 'production';

const localConfig = {
  apiKey: 'local-emulator-api-key',
  authDomain: 'demo-forge-rivals.firebaseapp.com',
  projectId: 'demo-forge-rivals',
  storageBucket: 'demo-forge-rivals.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:forgerivalslocal',
  measurementId: '',
};

const envConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
};

const hasHostedConfig =
  Boolean(envConfig.apiKey) &&
  Boolean(envConfig.authDomain) &&
  Boolean(envConfig.projectId) &&
  Boolean(envConfig.messagingSenderId) &&
  Boolean(envConfig.appId);

if (isProductionBuild && !useEmulators && !hasHostedConfig) {
  throw new Error(
    'Missing Firebase Web configuration. Set the required NEXT_PUBLIC_FIREBASE_* environment variables.'
  );
}

export const firebaseConfig = useEmulators
  ? localConfig
  : {
      ...localConfig,
      ...Object.fromEntries(
        Object.entries(envConfig).filter(([, value]) => value !== undefined && value !== '')
      ),
    };
