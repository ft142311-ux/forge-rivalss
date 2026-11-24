'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

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
  const app = getApps().length ? getApp() : initializeApp(config, 'forge-rivals-control');
  return getAuth(app);
}
