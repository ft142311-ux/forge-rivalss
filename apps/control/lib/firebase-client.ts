'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const APP_NAME = 'forge-rivals-control';
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function getControlAuth() {
  if (!config.apiKey || !config.authDomain || !config.appId || config.projectId !== 'forge-rivals-beta') {
    throw new Error('CONTROL_FIREBASE_CONFIG_INVALID');
  }
  // Resolve this named app explicitly; getApp() without a name would look for the
  // default app and fail on the second call because this app is intentionally named.
  const app = getApps().some(existing => existing.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(config, APP_NAME);
  return getAuth(app);
}