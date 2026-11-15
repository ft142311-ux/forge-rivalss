# Season orchestrator scheduler

The season lifecycle is invoked by a Firebase scheduled Cloud Function. Deploying
`runSeasonOrchestrator` creates the Cloud Scheduler trigger automatically; no
Vercel Cron configuration is required.

## Schedule

- Function: `runSeasonOrchestrator`
- Region: `us-central1`
- Frequency: every 5 minutes
- Time zone: UTC
- Function timeout: 540 seconds
- Maximum concurrent function instances: 1
- Target: the protected Next.js route
  `/api/cron/season-orchestrator`

The scheduled function sends an HTTPS GET request with
`Authorization: Bearer <CRON_SECRET>`. It fails the invocation if the endpoint
is unavailable, returns non-2xx, returns invalid JSON, or reports
`success !== true`. The secret is never included in logs.

## Required configuration

1. Set `SEASON_ORCHESTRATOR_URL` in the Functions environment file for the
   intended Firebase project (for example, `functions/.env.<project-id>`).
   Its value must be the exact public HTTPS App Hosting URL followed by
   `/api/cron/season-orchestrator`, with no query string.
2. Create or update the `CRON_SECRET` Secret Manager secret using
   `firebase functions:secrets:set CRON_SECRET`.
3. Ensure Firebase App Hosting binds that same `CRON_SECRET` secret. The
   existing `apphosting.yaml` declares the binding.
4. Keep the secret value out of Git, logs, command history, and client bundles.
   Use a long random value (at least 32 characters).

See `functions/.env.example` for the non-secret URL setting.

## Staging deployment and verification

Do not deploy this function to Production as part of code review. For the
isolated staging Firebase project only, after confirming the project alias,
App Hosting URL, and secret are correct, deploy the targeted function:

```sh
firebase deploy --only functions:runSeasonOrchestrator --project <STAGING_PROJECT_ID>
```

After deployment, verify the generated Cloud Scheduler job in Google Cloud
Console. Firebase names scheduled jobs using the pattern
`firebase-schedule-runSeasonOrchestrator-us-central1`.

Then inspect function logs for successful invocations. A successful invocation
logs only the returned status and action. A 401 from the route indicates a
secret mismatch; a 409 indicates the orchestrator correctly reported a blocked
or unsuccessful lifecycle step and the scheduled function will fail so it can
be observed and retried.

The existing `replaceInactiveClubs` daily scheduled function is independent
and is not changed by this scheduler.
