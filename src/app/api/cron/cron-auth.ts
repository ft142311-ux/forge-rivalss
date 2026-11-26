import { timingSafeEqual } from 'node:crypto';

/** Shared strict CRON_SECRET authentication for cron route handlers. */
export function isCronAuthorized(
  request: Pick<Request, 'headers'>,
  configuredSecret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (typeof configuredSecret !== 'string' || configuredSecret.length === 0) return false;

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;

  const supplied = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(configuredSecret, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
