# Forge-Rivals Beta launch runbook

## Scope and safety

This runbook applies only to the current Beta environment:

- GitHub repository: `ft142311-ux/forge-rivalss`
- Branch: `feature/beta-fresh-season-one`
- Firebase project: `forge-rivals-beta`
- Firestore location: `eur3`
- Hosting: Vercel Preview for the Beta branch

The older `docs/FREE-STAGING-DEPLOYMENT.md` describes the previous `forge-rivalstest` environment. Do not use it to configure the current Beta project.

**Production and `forge-rivalstest` must remain untouched.** Do not run reset, seed, restore, deploy, or activation commands as part of a read-only preflight. The repository's `.firebaserc` default alias is `demo-forge-rivals`; every intentional Firebase CLI operation must name `--project forge-rivals-beta` explicitly.

## Required infrastructure

### Firebase identity

Before deployment or bootstrap, verify in Firebase Console:

- Project ID is exactly `forge-rivals-beta`.
- Default Firestore database location is `eur3`.
- Email/Password Authentication is enabled.
- The Beta server service account belongs to this exact project.
- Client `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, server `GCLOUD_PROJECT`, and service-account `project_id` all match.

Do not copy credentials from the retired staging project or Production. Never commit service-account JSON, private keys, Admin SDK secrets, or Cron secrets.

The repository currently defines Firebase Functions in `us-central1`. This is separate from the Firestore `eur3` location; do not change the deployed Functions region without a separate latency and migration review.

### Vercel Preview only

Configure runtime variables only for:

- Environment: Preview
- Git branch: `feature/beta-fresh-season-one`
- Firebase project: `forge-rivals-beta`

Required server-side settings include `GCLOUD_PROJECT`, the public Firebase Web config, the matching `FIREBASE_ADMIN_SDK` credential, and `CRON_SECRET`. Keep Admin credentials and Cron secrets out of `NEXT_PUBLIC_*` variables. Verify Production variables were not changed.

A GitHub CI success does not prove that the latest commit is deployed. Confirm that the Vercel Preview is READY and its commit SHA matches the branch head.

### GitHub preflight credentials

The protected Preview workflow uses these repository secrets:

- `VERCEL_TOKEN`: permits the workflow to discover/access the exact protected Vercel Preview deployment.
- `BETA_RESET_CRON_SECRET`: the same value as the Beta Preview server-side `CRON_SECRET`, used only for the authenticated read-only GET.

For manual preflight dispatch, supply the immutable per-deployment READY Preview URL for the current commit (for example, `https://forge-rivalss-<deployment-id>-forge-rivals.vercel.app`). Do not use the mutable branch alias `forge-rivalss-git-feature-beta-fresh-season-one-forge-rivals.vercel.app`. The workflow verifies the supplied host against Vercel's READY Preview inventory and requires exact `githubCommitSha` and `githubCommitRef` metadata before it calls the Beta diagnostics endpoint. If no matching READY deployment exists, stop; never fall back to a previous Preview or branch alias.

Create or update these secrets through repository settings. Never write their values into Git, workflow logs, or this document. Do not bypass Vercel Deployment Protection to make the check pass.

## Season orchestrator and scheduled workers

The scheduled functions are defined in `functions/index.js` and run every five minutes in `us-central1`:

- `runSeasonOrchestrator`
- `runMarketExpirySweep`
- `runTournamentSweep`

They require:

- `SEASON_ORCHESTRATOR_URL` pointing at the exact HTTPS Beta host and `/api/cron/season-orchestrator` path.
- Secret Manager secret `CRON_SECRET`, bound to the scheduled functions.
- The same secret available to the Vercel Preview runtime.

Before deployment, inspect the Firebase project's Cloud Scheduler jobs and confirm that an equivalent schedule is not already active. Duplicate jobs can invoke lifecycle workers concurrently; code locks and transaction guards protect state, but duplicate schedules create unnecessary load.

The documented targeted deployment command is:

```sh
firebase deploy --only functions:runSeasonOrchestrator,functions:runMarketExpirySweep,functions:runTournamentSweep --project forge-rivals-beta
```

Do not run this command until Firebase project identity, URL, Secret Manager binding, existing job inventory, and authorization are verified. Do not use the default Firebase alias.

## Read-only readiness sequence

1. Confirm the current Git branch and latest CI commit.
2. Confirm Vercel Preview is READY for the same commit SHA.
3. Confirm the Preview uses the exact Beta Firebase project.
4. Run the authenticated GET preflight at `/api/admin/staging-cup-diagnostics`.
5. Inspect the sanitized result before taking any operational action.

The preflight verifies:

- Active season, phase, world readiness, and calendar.
- Exactly 15 league tables, 120 slots, and 840 league fixtures.
- Unfinished results and rollover-plan validity.
- Archive integrity and previous-season-only retention.
- The S1 Pyramid Cup completion and each later active-season Cup's participants, D1 entry, no-BYE field, snapshots, round structure, actual fixture documents, and BO3 final.
- Prepared next-season league world and its 56 opening Cup fixtures.
- History-cleanup and reset fences.

The endpoint is GET/read-only. A successful response does not mutate Firestore. A blocked response is a diagnosis, not permission to reset or bypass a lifecycle gate.

## Season 1 and S1 → S2 acceptance criteria

Before considering Season 1 ready:

- League: 15 groups, 120 clubs/slots, 14 tours, 840 fixtures.
- Pyramid Cup: 120 unique participants, 119 matches, 56 opening BO1 fixtures, eight D1 entrants in round two, no BYEs.
- All 120 participant snapshots are present and contain five players.
- Each current Cup round references its deterministic fixture documents; non-final rounds are BO1 and the final is BO3.
- All 840 league results are terminal and standings reconcile without structural conflicts.
- S1 archive and the S1→S2 promotion/relegation plan validate.
- S2 includes 15 tables, 120 slots, 840 fixtures, and its own fully validated Pyramid Cup before publication.
- S2 activates only through the normal orchestrator at the configured boundary.
- After activation, only the completed S1 archive remains visible; history cleanup must finish before further progression.

Season progression is strictly sequential: S1 → S2 → S3. Never skip a season because a scheduler invocation was delayed.

## Stop conditions

Stop and investigate without modifying live data when:

- Firebase project identity is ambiguous.
- Vercel Preview is not tied to the current Git commit.
- Cloud Scheduler inventory is unknown or duplicated.
- Cron secrets do not match.
- The live preflight is unavailable, stale, or reports incomplete league/Cup/archive data.
- The season boundary has passed but active/prepared season state is unclear.
- A reset journal, rollover lock, calendar lock, or history-cleanup marker remains active.

Do not call the destructive reset/restore endpoint or manually activate S2 as a way to clear one of these conditions. Establish exact live state from read-only diagnostics and scheduler logs first.
