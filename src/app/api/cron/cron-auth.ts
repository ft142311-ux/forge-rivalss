/** Shared strict CRON_SECRET authentication for cron route handlers. */
export function isCronAuthorized(
  request: Pick<Request, 'headers'>,
  configuredSecret: string | undefined = process.env.CRON_SECRET,
): boolean {
  return Boolean(configuredSecret)
    && request.headers.get('authorization') === `Bearer ${configuredSecret}`;
}
