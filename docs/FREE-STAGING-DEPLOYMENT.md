# Free staging deployment preparation

## Target branch

Prepare and review this branch before merging:
- `hosting/vercel-free-staging`

The default branch and production deployment are not changed by this preparation.

## Proposed hosting target

Vercel Hobby is a possible temporary Next.js staging target only for personal, non-commercial use. Do not use it for a commercial game/service or monetized deployment. The project's commercial status has not yet been confirmed, so hosting selection remains blocked pending that decision.

The repository uses Next.js App Router route handlers and Server Actions. Do not enable static export. The existing `firebase.json` static Hosting target is not the deployment path for this Next.js server application.

## Firebase staging project status

The user created a separate Firebase project:
- Project ID: `forge-rivalstest`
- Plan: Spark
- Firebase Web App: registered as `Forge-Rivals Web`
- Authentication: Email/Password provider enabled
- Cloud Firestore: Standard edition, `(default)` database, `europe-west3` (Frankfurt), production mode
- Firestore is currently empty.

Do not create collections manually or copy live game data at this stage. Do not enable Cloud Functions, App Hosting, scheduled backups, or write-capable cron jobs; the user needs to remain on the free Spark plan.

## Firebase Web configuration

`src/firebase/config.ts` now reads the Firebase Web App configuration from:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional)

Local emulator mode remains isolated: when `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`, the client uses the local `demo-forge-rivals` configuration and emulator endpoints. Non-production development without hosted variables also retains local defaults. A production build without the required hosted Web App values fails explicitly rather than silently targeting the local demo project.

`.env.example` documents the local emulator variables and the hosted Web App variable names. It contains no credentials.

## Remaining blockers before deployment

1. The new Firebase Web App values have not yet been entered as deployment environment variables.
2. `src/lib/firebase-admin.ts` uses Application Default Credentials outside emulator mode. A generic third-party host does not automatically provide Firebase App Hosting's service identity. A supported server credential mechanism must be deliberately configured as an encrypted deployment secret; never commit service-account JSON.
3. Firestore rules must be reviewed against the staging initialization/bootstrap workflow before any game data is written.
4. Existing cron routes have `maxDuration = 300`. Confirm host execution limits before invoking write-capable jobs.
5. The season orchestrator and match resolver write game state. They must not be called automatically until staging is initialized, isolated, and verified.
6. Hosting provider selection remains open until the project's commercial/non-commercial use is clarified.

## Read-only smoke check

`.github/workflows/staging-health-check.yml` adds a manual GitHub Actions workflow. It accepts an HTTPS deployment URL and calls only `GET /api/health`. The health endpoint reads `system_v1/global_stats`; it does not intentionally modify game data.

After the workflow file is merged into the repository's default branch, it can be started from GitHub:
1. Open **Actions**.
2. Select **Staging health check**.
3. Choose **Run workflow**.
4. Enter the HTTPS staging URL.

A successful result must report:
- `status: UP`
- `services.firestore: connected`

This check is not a deployment and does not run matches, tournaments, season transitions, or cron orchestration.

## GitHub Actions scheduler plan

GitHub Actions supports scheduled workflows at a shortest interval of five minutes. Scheduled workflows run from the repository's default branch, so a scheduler committed only to this preparation branch will not run until deliberately merged.

Do not add or enable a write-capable schedule yet. First complete the staging deployment and prove the read-only health check. Then separately add a protected, staging-only scheduler using GitHub Actions secrets for the HTTPS base URL and cron token. The target endpoint and cadence must be selected after checking idempotency and avoiding overlapping orchestrator/match-resolver calls.

## Safety rules

- Do not point staging at a live player database.
- Do not put service-account JSON, API secrets, or cron tokens in Git.
- Do not enable write-capable cron jobs during initial deployment.
- Do not run reset, cleanup, season rollover, or match simulation as part of a health check.
- Keep local Firebase Emulator configuration and regression tests intact.
- Do not merge this branch into `main` until the staging setup is reviewed and the user approves the next step.

## Firebase Admin credentials

The current `src/lib/firebase-admin.ts` now has three explicit modes: local Emulator Suite initialization; hosted initialization from the `FIREBASE_ADMIN_SDK` JSON secret; or Application Default Credentials only when `FIREBASE_ADMIN_USE_ADC=true` is deliberately set. Hosted service-account credentials are checked against the configured project ID when the credential JSON contains `project_id`. Missing credentials fail closed instead of silently attempting ADC.

Before using an external host:
- Create a dedicated staging service account in the staging Google Cloud project.
- Grant only the minimum Firestore and Firebase Auth permissions required by the app.
- Store credentials only in the host's encrypted environment/secrets facility.
- Prefer workload identity federation if the host supports it; otherwise use a dedicated service-account secret with rotation.
- Never use a production service account or commit credentials.

The Firebase client config is separate from Admin credentials. Client app identifiers are not a substitute for server authorization.

## Cron execution safety

The current `GET /api/cron/resolve-matches` endpoint performs calendar preparation and then runs league match resolution, friendly match resolution, and tournament processing concurrently. It is a write-capable endpoint, not a harmless health check.

The current `GET /api/cron/season-orchestrator` endpoint can settle overdue matches, publish a prepared season, and update season phase state. It is also write-capable.

Before scheduling either endpoint, verify:
- A Firestore-backed lease/lock prevents concurrent invocations across different workflow runs.
- A stable idempotency key prevents duplicate settlement of the same fixture.
- Lock expiry and recovery behavior are safe after timeout or process termination.
- The two cron endpoints cannot race each other over the same season/match records.
- The chosen host's maximum execution duration is sufficient for worst-case workload.
- The scheduler calls only the dedicated staging URL and uses a protected token.

Until those checks pass, the GitHub Actions workflow remains manual and read-only.

## Current safe milestone

The staging branch contains:
- A manual HTTPS health-check workflow calling `GET /api/health`.
- Environment-driven Firebase Web configuration with explicit production validation.
- Firebase Admin initialization that requires an explicit hosted credential source and checks the service-account project ID.
- An updated `.env.example` documenting local emulator, hosted Web SDK, and hosted Admin SDK variables.
- Documentation describing deployment and safety requirements.

No service credentials, Firestore rules, scheduled write operations, game data, local files, or production deployment have been changed by this milestone.
