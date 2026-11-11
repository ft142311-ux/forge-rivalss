# Free staging deployment preparation

## Target branch

Prepare and review this branch before merging:
- `hosting/vercel-free-staging`

The default branch and production deployment are not changed by this preparation.

## Proposed hosting target

Vercel Hobby is the simplest low-friction option for a temporary Next.js staging deployment. It is free, supports Next.js server rendering and route handlers, and currently documents a maximum Hobby function duration of 300 seconds when Fluid Compute is enabled.

**Important plan restriction:** Vercel Hobby is for personal, non-commercial use only. Do not use it for a commercial game/service or monetized production deployment. Confirm that the intended staging use is personal/non-commercial before connecting the repository. If the project is commercial, choose a host whose free tier permits that use.

The repository already uses standard Next.js App Router route handlers and Server Actions. No static export should be enabled. The existing `firebase.json` static Hosting target is not the deployment path for this Next.js server application.

## Current blockers before deployment

1. `src/firebase/config.ts` still hardcodes the local emulator project ID and placeholder app identifiers.
2. `src/lib/firebase-admin.ts` uses Application Default Credentials outside emulator mode. A generic Vercel runtime does not automatically provide Firebase App Hosting's service identity. A supported server credential mechanism must be deliberately configured as a deployment secret; never commit service-account JSON.
3. The new Firebase project `forge-rivalstest` currently has no registered Firebase Web App and no confirmed Auth/Firestore setup.
4. The existing cron routes have `maxDuration = 300`. Confirm the host's function duration setting and workload limits before invoking write-capable jobs.
5. The season orchestrator and match resolver write game state. They must not be called automatically until the staging database is initialized, isolated, and verified.

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


## Additional architecture audit findings

### Firebase Admin credentials

The current `src/lib/firebase-admin.ts` initializes with Application Default Credentials when emulator mode is disabled and no `FIREBASE_ADMIN_SDK` value is present. This is suitable only where the runtime supplies a correctly scoped Google service identity (for example, a configured Google Cloud runtime). A third-party host must not be assumed to provide ADC.

Before using Vercel or another external host:
- Create a dedicated staging service account in the staging Google Cloud project.
- Grant only the minimum Firestore and Firebase Auth permissions required by the app.
- Store credentials only in the host's encrypted environment/secrets facility.
- Prefer workload identity federation if the host supports it; otherwise use a dedicated service-account secret with rotation.
- Never use a production service account or commit credentials.

The Firebase client config is separate from Admin credentials. Client app identifiers are not a substitute for server authorization.

### Cron execution safety

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

### Current safe milestone

The staging branch contains only:
- A manual HTTPS health-check workflow calling `GET /api/health`.
- Documentation describing deployment and safety requirements.

No Firebase project configuration, service credentials, database rules, scheduled write operations, or game data have been changed by this deployment preparation.
