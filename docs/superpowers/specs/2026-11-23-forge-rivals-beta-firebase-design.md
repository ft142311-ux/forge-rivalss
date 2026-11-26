# Forge-Rivals Beta — New Firebase Infrastructure Design

**Status:** Approved direction. Cloud project creation and credential issuance require an authorized Firebase/Google Cloud control plane.

## Intent
Create a completely separate Firebase project for Forge-Rivals Beta in the Europe multi-region Firestore location `eur3`. New users, Authentication identities, clubs, Season 1 data, and Pyramid Cup data belong only to this new project. Preserve the existing `forge-rivalstest` project unchanged. Do not modify Vercel Production.

## Goals
- Isolate Beta from legacy staging project-level quotas, Auth identities, credentials, and data.
- Enable Email/Password Authentication in the new project.
- Create the default Firestore database in `eur3`.
- Deploy repository Firestore rules and indexes.
- Ensure browser SDK and server Admin SDK use the same exact project.
- Connect only Vercel Preview for `feature/beta-fresh-season-one`.
- Bootstrap a fresh canonical Season 1 and Pyramid Cup only after read-only preflight.
- Verify registration, login, profile reads, fixtures, and cup reads end to end.

## Non-goals
- Do not delete, reset, migrate, or modify `forge-rivalstest`.
- Do not modify Vercel Production variables or deployment.
- Do not migrate existing Auth users; this launch uses new accounts and clubs.
- Do not change game rules, league structure, or season lifecycle behavior.

## Approved decisions
- Candidate Firebase Project ID: `forge-rivals-beta`. Availability must be checked; if unavailable, ask before selecting another ID.
- Firestore location: `eur3`.
- Authentication: new project with Email/Password enabled.
- Firestore: default database.
- Vercel: Preview only, branch-scoped to `feature/beta-fresh-season-one`.
- Old project preserved; Production unchanged.

## Existing architecture findings
- `firebase.json` references `firestore.rules` and configures Auth/Firestore/Functions emulators.
- `firestore.rules` contains owner-scoped profile reads and server-authoritative game-state writes.
- `firestore.indexes.json` defines the current league slot composite index.
- `src/lib/firebase-admin.ts` resolves project identity from `GCLOUD_PROJECT`, `GCP_PROJECT`, or `NEXT_PUBLIC_FIREBASE_PROJECT_ID`; hosted mode requires `FIREBASE_ADMIN_SDK` or explicitly enabled ADC and validates service-account project consistency.
- `.env.example` defines public Web config and server Admin credential variable names.
- `functions/index.js` initializes Admin SDK from runtime credentials; scheduled/callable Functions currently target `us-central1`.
- CI uses emulator/demo project IDs; preserve these test IDs.
- Available connected tools expose GitHub and Vercel but no Firebase/Google Cloud project-creation API. Actual cloud project creation, billing linkage, Auth enablement, and service credential issuance cannot be performed from the current connected tools.

## Safety constraints
- Never commit service-account JSON, private keys, API secrets, or cron secrets.
- Never place Admin credentials in `NEXT_PUBLIC_*` variables.
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `GCLOUD_PROJECT`, and service-account `project_id` must match.
- Only update Preview variables for the named branch; leave Production and other environments unchanged.
- Keep old project configuration separate.
- Before seeding, verify effective client/server project IDs and Firestore location.
- Destructive bootstrap/reset must require explicit target project ID and read-only preflight.

## Approaches
1. Reuse old staging project with new collections — rejected because project-level quotas, Auth, credentials, and access remain shared.
2. New Firebase project and Preview cutover — selected; provides independent Auth, Firestore, quotas, credentials, and data while preserving rollback.
3. Second Firestore database in old project — rejected because Auth and project-level controls/quotas remain shared.

## Acceptance criteria
- New Firebase project exists with confirmed project ID and Firestore location `eur3`.
- Email/Password Auth enabled.
- Rules and indexes deployed.
- Client and Admin runtime resolve to the same new project.
- Only branch-scoped Preview variables updated.
- Read-only preflight confirms no cross-access to old project and no Production changes.
- Fresh world has 15 tables, 120 slots, 840 league matches, 120 cup participants, and 119 cup bracket matches.
- New registration creates one club idempotently; re-login returns to same club.
- Emulator tests and CI pass.
