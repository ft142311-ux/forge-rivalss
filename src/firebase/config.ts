/**
 * @fileOverview Конфигурация Firebase v1.4 (Secure Env).
 */

export const firebaseConfig = {
  projectId: "demo-forge-rivals",
  appId: "1:000000000000:web:forgerivalslocal",
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: "demo-forge-rivals.firebaseapp.com",
  measurementId: "",
  messagingSenderId: "000000000000"
};
