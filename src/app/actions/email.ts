'use server';

/**
 * @fileOverview Серверный модуль для работы с Email v2.0 (Admin SDK Transition).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import nodemailer from 'nodemailer';
import { EmailInputSchema, VerifyCodeSchema } from '@/app/lib/validation-schemas';
import { logger } from '@/app/lib/logger';

const RATE_LIMIT_MS = 60000;
const MAX_VERIFICATION_ATTEMPTS = 5; 

const transporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
}) : null;

export async function sendVerificationEmail(email: string) {
  const validation = EmailInputSchema.safeParse({ email });
  if (!validation.success) return { success: false, error: "INVALID_EMAIL" };

  const db = getAdminDb();
  const normalizedEmail = String(validation.data.email).trim().toLowerCase();
  const codeRef = db.collection('verification_codes').doc(normalizedEmail);
  const rateLimitRef = db.collection('verification_rate_limits').doc(normalizedEmail);
  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 15 * 60000);

  try {
    const allowed = await db.runTransaction(async (tx) => {
      const [existingSnap, rateLimitSnap] = await Promise.all([
        tx.get(codeRef),
        tx.get(rateLimitRef),
      ]);
      const rateLimit = rateLimitSnap.exists ? (rateLimitSnap.data() || {}) : {};
      const rawLastSent = rateLimit.lastSentAt;
      const lastSentAtMs = rawLastSent?.toMillis?.()
        ?? (rawLastSent instanceof Date ? rawLastSent.getTime() : Date.parse(String(rawLastSent || '')));
      if (Number.isFinite(lastSentAtMs) && Date.now() - lastSentAtMs < RATE_LIMIT_MS) return false;

      // Compatibility fallback for a code created before the persistent rate
      // limit record existed.
      if (existingSnap.exists && !rateLimitSnap.exists) {
        const existing = existingSnap.data() || {};
        const rawCreatedAt = existing.createdAt;
        const createdAtMs = rawCreatedAt?.toMillis?.()
          ?? (rawCreatedAt instanceof Date ? rawCreatedAt.getTime() : Date.parse(String(rawCreatedAt || '')));
        if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs < RATE_LIMIT_MS) return false;
      }

      tx.set(codeRef, {
        code,
        attempts: 0,
        expiresAt,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(rateLimitRef, {
        lastSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });

    if (!allowed) return { success: false, error: "RATE_LIMIT_EXCEEDED" };

    if (transporter) {
      try {
        await transporter.sendMail({
          from: '"Lines of Enmity" <noreply@mobamanageronline.app>',
          to: normalizedEmail,
          subject: "Verification Code",
          text: `Your verification code: ${code}`,
          html: `<div style="background:#0a0d14;color:white;padding:40px;text-align:center;font-family:sans-serif;">
                  <h1 style="color:#0ea5e9;letter-spacing:2px;">SECURITY LINK</h1>
                  <p style="opacity:0.7;">Use the following code to establish command frequency:</p>
                  <div style="background:#1a1f2e;padding:20px;display:inline-block;border-radius:10px;margin:20px 0;">
                    <span style="font-size:32px;font-weight:bold;color:white;letter-spacing:8px;">${code}</span>
                  </div>
                  <p style="font-size:10px;opacity:0.5;margin-top:20px;">Expire time: 15 minutes</p>
                </div>`,
        });
      } catch (e: any) {
        logger.error("SMTP Error", e);
        return { success: true, warning: "SMTP_FAILED" };
      }
    }

    return { success: true };
  } catch (error: any) {
    logger.error("sendVerificationEmail Error", error);
    return { success: false, error: "INTERNAL_ERROR" };
  }
}

export async function verifyEmailCode(email: string, inputCode: string) {
  const validation = VerifyCodeSchema.safeParse({ email, code: inputCode });
  if (!validation.success) return { success: false, error: "INVALID_INPUT" };

  const db = getAdminDb();
  const normalizedEmail = String(validation.data.email).trim().toLowerCase();
  const normalizedCode = String(validation.data.code).trim();
  try {
    const codeRef = db.collection('verification_codes').doc(normalizedEmail);
    return await db.runTransaction(async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) return { success: false, error: "CODE_NOT_FOUND" };
      const data = codeSnap.data() || {};
      const expiresAtMs = data.expiresAt?.toMillis?.()
        ?? (data.expiresAt instanceof Date ? data.expiresAt.getTime() : Date.parse(String(data.expiresAt || '')));

      if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
        tx.delete(codeRef);
        return { success: false, error: "CODE_EXPIRED" };
      }

      const attemptsSoFar = Math.max(0, Number(data.attempts || 0));
      if (attemptsSoFar >= MAX_VERIFICATION_ATTEMPTS) {
        return { success: false, error: "TOO_MANY_ATTEMPTS" };
      }

      if (String(data.code || '') !== normalizedCode) {
        const attempts = attemptsSoFar + 1;
        if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
          // Keep the document (and its original createdAt) so a caller cannot
          // bypass the resend throttle by exhausting the code and deleting it.
          tx.update(codeRef, { attempts: MAX_VERIFICATION_ATTEMPTS, code: null, lockedAt: FieldValue.serverTimestamp() });
          return { success: false, error: "TOO_MANY_ATTEMPTS" };
        }
        tx.update(codeRef, { attempts });
        return { success: false, error: "INVALID_CODE", attemptsRemaining: MAX_VERIFICATION_ATTEMPTS - attempts };
      }

      tx.delete(codeRef);
      return { success: true };
    });
  } catch (e: any) {
    logger.error("verifyEmailCode Error", e);
    return { success: false, error: "INTERNAL_ERROR" };
  }
}
