# New Forge-Rivals Beta Firebase Project Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Verify each stage before proceeding.

**Goal:** Provision and connect an isolated Firebase project for Forge-Rivals Beta in `eur3`, preserving legacy staging and Production.

**Architecture:** Create a new Firebase project with independent Authentication and Firestore, deploy current repository rules/indexes, then connect only the Beta Preview branch through branch-scoped Vercel variables. Bootstrap Season 1 only after read-only identity/location preflight.

**Tech Stack:** Firebase Authentication, Cloud Firestore, Firebase CLI, Firebase Admin SDK, Next.js, Vercel Preview, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-23-forge-rivals-beta-firebase-design.md`

## Global Constraints
- Firestore location exactly `eur3`.
- Candidate project ID `forge-rivals-beta`; verify availability first.
- Preserve `forge-rivalstest` unchanged.
- Do not modify Vercel Production.
- Start with new Auth users and new clubs; no Auth migration.
- Never commit service-account JSON or secrets.
- Browser project ID, `GCLOUD_PROJECT`, and service-account `project_id` must match.
- Keep emulator project IDs and CI tests unchanged.
- No seeding before read-only preflight.

## Review Focus
- Wrong Firebase project selected by either runtime side — add startup identity assertion.
- Old service account paired with new Web config — test mismatch fails closed.
- Preview variables accidentally applied to Production — verify environment and branch scope.
- Rules/indexes missing or too permissive — deploy exact repo files and run security tests.
- Seed script targets wrong project — require explicit ID and generation confirmation.

---

### Task 1: Provision isolated Firebase project

**Files:** Firebase Console / Google Cloud Console only.

- [ ] Confirm candidate project ID `forge-rivals-beta` is available.
- [ ] Create project with confirmed ID; if unavailable, stop and ask for a replacement ID.
- [ ] Link billing only if required; do not assume billing tier.
- [ ] Create default Firestore database in `eur3`.
- [ ] Enable Email/Password Authentication.
- [ ] Register a Web App and record public config.
- [ ] Create a dedicated runtime service identity/credential with least privilege.
- [ ] Record confirmed project ID and location.

**Verification:** Console confirms exact ID, Firestore location, and Auth provider.

### Task 2: Deploy Firestore rules and indexes

**Files:** `firebase.json`, `firestore.rules`, `firestore.indexes.json`.

- [ ] Authenticate Firebase CLI for the authorized operator.
- [ ] Add a temporary explicit CLI project alias if needed; do not replace existing aliases/defaults.
- [ ] Deploy rules and indexes to the confirmed new project.
- [ ] Run Firestore emulator/rules tests.
- [ ] Confirm no command targets `forge-rivalstest`.

**Verification:** CLI reports rules and indexes deployed to the new project.

### Task 3: Harden Firebase project identity

**Files:** `src/lib/firebase-admin.ts`, `.env.example`, client Firebase initializer under `src/firebase/`; tests under `tests/`.

- [ ] Add hosted fail-closed checks; no fallback to `demo-forge-rivals` in hosted mode.
- [ ] Require Admin service-account project ID, `GCLOUD_PROJECT`, and public project ID to match.
- [ ] Preserve emulator mode and its local hosts/project IDs.
- [ ] Test matching IDs, mismatched credential ID, missing hosted ID, and emulator mode.
- [ ] Run TypeScript and focused tests.

**Verification:** Hosted mismatches fail clearly; emulator tests remain green.

### Task 4: Configure Vercel Preview only

**Files:** Vercel environment configuration; no committed secrets.

- [ ] Add new Web Firebase config to Preview only, branch `feature/beta-fresh-season-one`.
- [ ] Add `GCLOUD_PROJECT` with the confirmed new ID to the same branch.
- [ ] Add `FIREBASE_ADMIN_SDK` as encrypted Preview secret containing the new project's service-account JSON.
- [ ] Keep `FIREBASE_ADMIN_USE_ADC=false` unless ADC is explicitly configured.
- [ ] Verify Production and other environments unchanged.
- [ ] Redeploy Beta Preview.

**Verification:** Deployment is Preview/branch scoped and client/server diagnostics report the same project without exposing credentials.

### Task 5: Deploy Firebase Functions and secrets

**Files:** `functions/index.js`, `functions/package.json`, `functions/.env.example`.

- [ ] Review scheduled/callable functions and required secrets.
- [ ] Set only required secrets in new project's Secret Manager.
- [ ] Deploy Functions only after explicit project ID confirmation.
- [ ] Review current `us-central1` Functions region against Firestore `eur3`; do not change region without separate approval.
- [ ] Verify functions and scheduled jobs belong to new project.

**Verification:** Function inventory and schedules are present in new project.

### Task 6: Add new-project read-only preflight

**Files:** Create `scripts/beta-firebase-preflight.cjs`; test `tests/beta-firebase-preflight.test.mjs`.

- [ ] Test rejection of old project ID and emulator/demo IDs.
- [ ] Test missing/mismatched IDs and missing Admin credentials.
- [ ] Ensure preflight is read-only.
- [ ] Run preflight against new project.
- [ ] Confirm location and clean seed state.

**Verification:** Only the confirmed new project passes; no writes occur.

### Task 7: Bootstrap clean Season 1 and Pyramid Cup

**Files:** Existing canonical world bootstrap/reset scripts and tests.

- [ ] Confirm target project ID immediately before bootstrap.
- [ ] Run canonical bootstrap once.
- [ ] Verify 15 tables, 120 slots, 840 league matches, 120 cup participants, 119 bracket matches.
- [ ] Verify worldReady and Pyramid Cup readiness.
- [ ] Preserve all old-project data.

**Verification:** Read-only status endpoint returns expected counts from new project.

### Task 8: End-to-end Beta verification

**Files:** Existing registration/auth tests and CI workflow.

- [ ] Create one disposable new-project test account.
- [ ] Verify registration creates exactly one club/profile.
- [ ] Verify profile read and navigation to game.
- [ ] Verify logout/login returns to the same club.
- [ ] Verify repeated initialization is idempotent.
- [ ] Run TypeScript, regression, emulator, and production-build checks.
- [ ] Confirm Production configuration/deployment unchanged.

**Verification:** All tests pass and both new-account and returning-account journeys work on Beta Preview.
