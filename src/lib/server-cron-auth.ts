import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/** Rejects direct invocation of internal cron workers without the server secret. */
export function assertCronSecret(candidate: unknown): void {
  const configured = process.env.CRON_SECRET;
  if (typeof candidate !== 'string' || !configured) {
    throw new Error('CRON_AUTH_REQUIRED');
  }

  const suppliedBuffer = Buffer.from(candidate, 'utf8');
  const configuredBuffer = Buffer.from(configured, 'utf8');
  if (suppliedBuffer.length !== configuredBuffer.length ||
      !timingSafeEqual(suppliedBuffer, configuredBuffer)) {
    throw new Error('CRON_AUTH_REQUIRED');
  }
}
