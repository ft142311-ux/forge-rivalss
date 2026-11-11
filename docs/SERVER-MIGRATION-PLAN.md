# Forge-Rivals server migration plan

## Goal

Move Forge-Rivals from a developer-local runtime to a hosted Next.js + Firebase runtime in controlled stages. Local emulators remain available for development and regression tests; they must not be a runtime dependency of the hosted game.

## Current repository findings

- The application is a Next.js 15.5.9 app and uses Server Actions and Route Handlers. The hosted target should run the Next.js server runtime, not a static export.
- `apphosting.yaml` already exists, so Firebase App Hosting is the intended hosting path.
- `firebase.json` still contains a Firebase Hosting static target (`public: out`). It must not be treated as the deployment path for the full application unless the app is deliberately converted to static export (not recommended).
- `.firebaserc` currently selects Firebase project `studio-2788872209-f7092`.
- `src/firebase/config.ts` currently hardcodes `demo-forge-rivals` and placeholder local app identifiers. This conflicts with the selected Firebase project and is a deployment blocker.
- `src/lib/firebase-admin.ts` supports Application Default Credentials when emulator mode is disabled, which is appropriate for App Hosting, but the runtime project selection and credentials must be verified in the deployed environment.
- Cron route handlers already exist for season orchestration and tournaments. They require a reliable external scheduler and protected server secrets.
- Firestore rules are mostly server-authoritative for core game state. This is a useful foundation for hosted operation.

## Migration stages

### Stage 0 — Deployment inventory (no production writes)

1. Confirm the intended Firebase project and its Firebase Web App configuration.
2. Confirm App Hosting backend, region, service account/runtime identity, and deployment branch.
3. Inventory required environment variables and Secret Manager values.
4. Verify that production-mode code never connects to emulator endpoints.
5. Identify all scheduled endpoints and their expected cadence.

Exit criteria: a complete deployment configuration checklist with no guessed Firebase identifiers.

### Stage 1 — Environment separation

1. Make browser Firebase configuration environment-driven.
2. Keep emulator connection logic behind an explicit local-only flag.
3. Make production startup fail clearly when required Firebase client configuration is missing or points to the demo project.
4. Keep Firebase Admin on Application Default Credentials in App Hosting; do not deploy a local service-account JSON file.
5. Keep destructive reset/recovery tooling unavailable in hosted production.

Exit criteria: local emulator and hosted configuration are separate, explicit, and testable.

### Stage 2 — Hosted staging backend

1. Deploy the Next.js application to a staging App Hosting backend.
2. Connect it to a dedicated staging Firebase project/database, not the live player world.
3. Apply Firestore rules and required indexes to staging.
4. Configure Authentication providers and authorized domains.
5. Configure cron scheduling and secrets.
6. Run health checks, registration, login, profile, match, report, tournament, and season-cycle smoke tests.

Exit criteria: staging can run the complete core game loop without a local process.

### Stage 3 — Controlled live readiness

1. Back up and validate the target database.
2. Run read-only integrity checks against the intended live project.
3. Validate rollback and recovery procedures.
4. Enable scheduled jobs only after manual smoke tests pass.
5. Gradually direct users to the hosted runtime.

Exit criteria: the hosted game operates independently and has verified recovery procedures.

## Non-negotiable safety rules

- Never deploy or run destructive reset scripts against a live project.
- Never point staging at the live player database.
- Never use the Firebase Emulator project ID in a hosted build.
- Do not enable cron jobs until secrets, authorization, idempotency, and duplicate-run protection are verified.
- Keep emulator tests as a regression tool; do not remove them during migration.
- Do not change season data or player data as part of infrastructure migration.

## Immediate blockers to resolve

1. Firebase Web App configuration values for the intended hosted project: project ID, app ID, messaging sender ID, auth domain, and API key.
2. Confirmation that `studio-2788872209-f7092` is the intended staging project or intended live project.
3. Confirmation of the App Hosting backend and region.
