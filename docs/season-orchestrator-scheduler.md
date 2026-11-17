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
- HTTP request timeout: 270 seconds (30-second margin below the Next.js route's 300-second `maxDuration`)
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
   Its value must be the exact public HTTPS URL of the deployed Next.js app followed
   by `/api/cron/season-orchestrator`, with no query string.
2. Create or update the `CRON_SECRET` Secret Manager secret once, using
   `firebase functions:secrets:set CRON_SECRET`. Use the same project ID for
   the scheduled Function and the App Hosting backend.
3. If the secret was created through the Functions CLI, grant the App Hosting
   backend access to that same Secret Manager secret:
   `firebase apphosting:secrets:grantaccess CRON_SECRET --backend <BACKEND_ID> --location <REGION>`.
   If the secret was created through the App Hosting CLI instead, verify that the
   Functions deployment can bind it through `runWith({ secrets: ['CRON_SECRET'] })`.
4. The repository's `apphosting.yaml` declares `CRON_SECRET` as a runtime-only
   secret. If the staging deployment uses another host (for example Vercel),
   configure the same secret in that host's server-side environment settings instead.
5. Keep the secret value out of Git, logs, command history, and client bundles.
   Use a long random value (at least 32 characters).

See `functions/.env.example` for the non-secret URL setting.

## Staging deployment and verification

Do not deploy this function to Production as part of code review. The repository's
`.firebaserc` default project alias has not been verified as the staging target.
Never rely on the implicit Firebase default or run a deploy without an explicit
`--project` value. For the isolated staging Firebase project only, first verify its
project ID in Firebase Console and confirm it is not the protected Production
project. Then confirm the App Hosting URL and secret before deploying the targeted function:

```sh
firebase deploy --only functions:runSeasonOrchestrator --project <STAGING_PROJECT_ID>
```

Before deployment, inspect the target Firebase project's Cloud Scheduler jobs
and confirm that an equivalent five-minute season-orchestrator job is not already
active; otherwise two schedulers could invoke the route. After deployment, verify
the generated Cloud Scheduler job in Google Cloud Console. Firebase names scheduled
jobs using the pattern
`firebase-schedule-runSeasonOrchestrator-us-central1`.

Then inspect function logs for successful invocations. A successful invocation
logs only the returned status and action. A 401 from the route indicates a
secret mismatch; a 409 indicates the orchestrator correctly reported a blocked
or unsuccessful lifecycle step and the scheduled function will fail so it can
be observed and retried.

The existing `replaceInactiveClubs` daily scheduled function is independent
and is not changed by this scheduler.
