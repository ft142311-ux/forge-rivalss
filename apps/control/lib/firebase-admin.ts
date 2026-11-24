import 'server-only';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'forge-rivals-beta';

function adminApp() {
  const configured = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (configured !== PROJECT) throw new Error('CONTROL_PROJECT_MISMATCH');
  const existing = getApps().find(app => app.name === 'forge-rivals-control-admin');
  if (existing) {
    if (existing.options.projectId !== PROJECT) throw new Error('CONTROL_ADMIN_PROJECT_MISMATCH');
    return existing;
  }
  const raw = process.env.FIREBASE_ADMIN_SDK;
  if (!raw) throw new Error('CONTROL_ADMIN_CREDENTIALS_MISSING');
  let account: Record<string, unknown>;
  try { account = JSON.parse(raw); } catch { throw new Error('CONTROL_ADMIN_CREDENTIALS_INVALID'); }
  if (account.project_id !== PROJECT) throw new Error('CONTROL_ADMIN_CREDENTIAL_PROJECT_MISMATCH');
  return initializeApp({ credential: cert(account as any), projectId: PROJECT }, 'forge-rivals-control-admin');
}

export function controlDb() { return getFirestore(adminApp()); }
export function controlAuth() { return getAuth(adminApp()); }

export async function requireControlAdmin(token: string) {
  if (!token) throw new Error('AUTHENTICATION_REQUIRED');
  const decoded = await controlAuth().verifyIdToken(token, true);
  const allowlist = (process.env.CONTROL_ADMIN_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (decoded.admin !== true || !allowlist.includes(decoded.uid)) throw new Error('CONTROL_ADMIN_REQUIRED');
  return { uid: decoded.uid };
}
