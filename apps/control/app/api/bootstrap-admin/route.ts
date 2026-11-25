import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { controlAuth, controlDb } from '../../../lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT = 'forge-rivals-beta';
const LOCK_PATH = 'control_security_v1/admin_bootstrap';

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } });
}

function secretMatches(provided: string, expected: string) {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  try {
    if (process.env.GCLOUD_PROJECT !== PROJECT || !process.env.BOOTSTRAP_ADMIN_SECRET) {
      return reply(200, { enabled: false });
    }
    const lock = await controlDb().doc(LOCK_PATH).get();
    return reply(200, { enabled: !lock.exists });
  } catch {
    return reply(503, { enabled: false, error: 'BOOTSTRAP_STATUS_UNAVAILABLE' });
  }
}

export async function POST(request: NextRequest) {
  const expected = process.env.BOOTSTRAP_ADMIN_SECRET || '';
  if (process.env.GCLOUD_PROJECT !== PROJECT || expected.length < 32) {
    return reply(404, { success: false, error: 'BOOTSTRAP_DISABLED' });
  }

  let body: { email?: unknown; password?: unknown; setupSecret?: unknown };
  try { body = await request.json(); } catch { return reply(400, { success: false, error: 'INVALID_REQUEST' }); }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const setupSecret = typeof body.setupSecret === 'string' ? body.setupSecret : '';
  if (!secretMatches(setupSecret, expected)) return reply(403, { success: false, error: 'INVALID_SETUP_SECRET' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return reply(400, { success: false, error: 'INVALID_EMAIL' });
  }
  if (password.length < 12 || password.length > 128) {
    return reply(400, { success: false, error: 'PASSWORD_POLICY_REQUIRES_12_TO_128_CHARACTERS' });
  }

  const db = controlDb();
  const lockRef = db.doc(LOCK_PATH);
  try {
    const reserved = await db.runTransaction(async tx => {
      const snapshot = await tx.get(lockRef);
      if (snapshot.exists) return false;
      tx.create(lockRef, { status: 'reserved', project: PROJECT, createdAt: new Date().toISOString() });
      return true;
    });
    if (!reserved) return reply(409, { success: false, error: 'ADMIN_BOOTSTRAP_ALREADY_USED' });

    const auth = controlAuth();
    const user = await auth.createUser({ email, password, emailVerified: false, disabled: false });
    await auth.setCustomUserClaims(user.uid, { admin: true });
    await lockRef.update({ status: 'completed', uid: user.uid, email, completedAt: new Date().toISOString() });
    return reply(201, { success: true, uid: user.uid, email, project: PROJECT });
  } catch (error) {
    try { await lockRef.update({ status: 'failed', failedAt: new Date().toISOString() }); } catch {}
    const code = String((error as { code?: string })?.code || '');
    if (code === 'auth/email-already-exists') return reply(409, { success: false, error: 'EMAIL_ALREADY_REGISTERED_BOOTSTRAP_LOCKED' });
    return reply(503, { success: false, error: 'ADMIN_BOOTSTRAP_FAILED' });
  }
}
