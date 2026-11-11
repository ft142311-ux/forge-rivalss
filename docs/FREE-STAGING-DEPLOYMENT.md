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
2. `src/lib/firebase-admin.ts` supports explicit hosted credentials, but the staging service account has not been created and no secret has been configured.
3. Registration has been moved in this branch to `POST /api/registration/initialize`, a Node.js Next.js route. It verifies Firebase ID tokens with revocation checking, validates a bounded JSON payload, uses the shared registration core, and commits slot/table/bot/match/player changes in one Firestore transaction. A successful registration writes a server-side audit event. The setup page now calls this endpoint. The old callable remains for local emulator compatibility only; do not deploy it to Spark.
4. Firestore rules must be reviewed against the staging initialization/bootstrap workflow before any game data is written.
5. Existing cron routes have `maxDuration = 300`. Confirm host execution limits before invoking write-capable jobs.
6. The season orchestrator and match resolver write game state. They must not be called automatically until staging is initialized, isolated, and verified.
7. Hosting provider selection remains open until the project's commercial/non-commercial use is clarified.

## Branch validation workflow

`.github/workflows/staging-validation.yml` runs on pushes and pull requests targeting `hosting/vercel-free-staging`, and can also be started manually. It installs dependencies, runs TypeScript checks, core regression tests, the full test suite, and a production build. It uses the local emulator configuration and requires no Firebase credentials. It does not deploy the application or execute game operations.

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

## Spark-plan compatibility finding

Firebase's official pricing documentation states that Cloud Functions cannot be newly deployed while a project remains on Spark. This branch therefore routes registration through the Next.js server runtime instead of deploying the legacy callable. See the official [Firebase pricing plan documentation](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) and [Cloud Functions FAQ](https://firebase.google.com/docs/functions/faq-and-troubleshooting).

## Registration security status

Implemented in this branch:
- Firebase ID token verification with revocation checking; the UID is taken only from the verified token, never from the request body.
- Strict POST/JSON contract, request-size limit (including requests without `Content-Length`), allowed-field validation, club-name normalization, and no-store responses.
- Idempotent registration for an already-created player profile.
- Shared validation logic for eligible league slots and the complete 56-fixture schedule, used by both the legacy emulator callable and the hosted route.
- One Firestore transaction for slot claim, league table replacement, bot profile removal, all fixture participant replacements, player creation, global counter update, and a server-side success audit event.
- Generic client errors for unexpected server failures; internal details are logged server-side.

Not yet production-ready; these are explicit next security gates:
- Configure Firebase App Check for the actual Web App, send its token from the browser, and set `FIREBASE_APPCHECK_REQUIRED=true` only after a verified staging test. The endpoint supports enforcement, but it is not enabled by default yet.
- Add abuse throttling at the hosting edge and/or a carefully designed server-side rate limiter. Do not rely on in-memory counters in a horizontally scaled serverless runtime.
- Verify email-verification policy and account recovery requirements; the current registration preserves the existing email-required behavior and does not newly require `email_verified`.
- Add emulator integration tests for concurrent first-time registration, transaction retries, already-initialized accounts, and rollback on invalid/missing world data.
- Review service-account IAM permissions, Firestore rules, audit retention, and deployment secrets before any real staging write.

## Current safe milestone

The staging branch contains:
- A branch validation workflow for typecheck, regression tests, full tests, and production build.
- A manual HTTPS health-check workflow calling `GET /api/health`.
- Environment-driven Firebase Web configuration with explicit production validation.
- Firebase Admin initialization that requires an explicit hosted credential source and checks the service-account project ID.
- A Spark-compatible authenticated registration route and shared registration core, with regression tests for slot/schedule invariants.
- An updated `.env.example` documenting local emulator, hosted Web SDK, and hosted Admin SDK variables.
- Documentation describing deployment and safety requirements.

No service credentials, Firestore rules, scheduled write operations, game data, local files, or production deployment have been changed by this milestone. The new registration endpoint has not yet been validated against a live staging database and must not be treated as production-ready.
