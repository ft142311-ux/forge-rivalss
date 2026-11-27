# Forge-Rivals Beta readiness audit

**Audit date:** 2026-11-27  
**Repository:** ft142311-ux/forge-rivalss  
**Branch:** feature/beta-fresh-season-one  
**Audited head:** a90f1bd23cfb767b173f633b6bb1344051d88fa6  
**Firebase target:** forge-rivals-beta (Firestore region eur3)  
**Scope:** read-only source/workflow audit and review of recorded CI evidence. No live Firebase reads, writes, resets, deployments, or season activations were performed for this audit.

## Executive decision

**Current decision: NO-GO for opening Beta to players until the P0 gates below are evidenced.**

The codebase has substantial automated coverage and the latest branch validation is green, including the combined public Season 1 -> Season 2 lifecycle against an isolated Emulator. Green CI is not equivalent to a verified live Beta world or live scheduled-worker operation.

The readiness percentage is a planning estimate, not a test metric:

- **75% estimated overall implementation/readiness** (historical estimate; not recalculated by this verification)
- **Build and automated branch validation:** green on the audited head
- **Live Beta readiness:** not established by this audit
- **Full Season 1 -> Season 2 end-to-end acceptance:** PASS in isolated Firestore Emulator on commit `a90f1bd` (CI #46007076460)

Do not interpret the percentage as permission to reset, seed, publish, or activate a live season.

## Verified evidence

### Latest CI

GitHub Actions run [#46007076460](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46007076460), push event for audited head `a90f1bd23cfb767b173f633b6bb1344051d88fa6`, completed successfully.

Main application job:
- TypeScript check
- Core regression tests
- Full test suite
- Firestore Emulator registration transactions
- Pyramid Cup prepared-season Emulator scenario
- Fresh Season 1 reset / archive / resume / restore Emulator scenario
- Production build

Separate Control application job:
- Security regression tests
- TypeScript check
- Production build

Earlier push runs canceled by concurrency were superseded by the successful run on the latest audited head. They are not treated as failures of the current head.

### Existing test inventory

The branch contains 147 tests/*.test.mjs files. The inventory includes dedicated test groups for:
- season orchestration, rollover, archive, history cleanup, recovery, activation and write fences;
- Pyramid Cup bracket integrity, frozen snapshots, round progression, prize idempotency, report integration and preparation;
- registration APIs and Emulator transactions;
- economy ledgers, market bids, auction settlement and expiry;
- match settlement, match reports, unread report counts and friendly match terminal states.

The existing Cup Emulator scenario includes full progression through all seven rounds and all 119 fixtures, BO3 finalization, champion payout/trophy integrity, and replay idempotency. The clean Season 1 Emulator scenario separately verifies canonical world generation and pre-season Cup creation. The existence of tests does not by itself prove every live workflow or every cross-system path is covered. Only the commands and scenarios listed in the CI run above are confirmed as executed on the audited head.

### Existing read-only Beta preflight

.github/workflows/beta-season-one-preflight.yml invokes the protected GET-only diagnostics endpoint. The route:
- requires cron authorization;
- checks the configured Firebase project is exactly forge-rivals-beta;
- reports aggregate league counts and rollover diagnostics;
- validates active/prepared Pyramid Cup structure and participant snapshots;
- reports archive retention, next rollover, prepared successor, history cleanup and reset state.

The workflow is a separate operational gate. A green branch CI does not prove that this preflight has passed against the current live Beta Preview.

## Findings and gaps

### P0 — release blockers

1. **Fresh live Beta preflight not evidenced.** Obtain a fresh authenticated read-only result for the exact current Preview commit and exact forge-rivals-beta project. Until then, actual Beta database readiness remains unknown.
2. **Combined Season 1 -> Season 2 Emulator lifecycle:** implementation and isolated acceptance now exist. The scenario exercises the public lifecycle functions `ensureSeasonCalendar(2)`, `publishPreparedSeason()`, and `activatePublishedSeason()`; asserts Season 2's 15 tables, 120 slots, 840 fixtures and complete 120-participant / 119-match no-BYE Pyramid Cup; and verifies retained Season 1 archive/cleanup. The separate Cup Emulator scenario covers all seven rounds and 119 fixtures, BO3 final and prize/trophy idempotency. This is source/Emulator evidence, not a live Beta run.
3. **Live Season 1 -> Season 2 operational acceptance remains unproven.** Isolated Emulator lifecycle acceptance is green; live Beta readiness still requires exact-SHA Preview and authenticated read-only preflight. Do not infer live scheduler execution or operational readiness from Emulator results.
4. **Actual scheduled-worker configuration is not verified.** The runbook requires the exact Beta orchestrator URL, matching Cron secret, correct Secret Manager binding and a single intended Cloud Scheduler schedule. This requires a read-only infrastructure inventory before any operational change.
5. **Do not run destructive reset or live activation as a substitute for diagnosis.** Any reset remains behind fresh preflight and explicit user authorization.

### P1 — required before wider Beta

6. **Archive retention needs a live evidence check.** The diagnostics route computes archiveRetention.matchesPolicy; verify it reports exactly the single previous completed season and that this is enforced by backend cleanup, not only by UI filtering.
7. **Registration must be exercised as a complete user journey.** The CI runs registration Emulator transactions, but a browser-level Beta journey still needs checking: register -> authenticate -> create profile -> create club -> allocate league slot -> enter game, including retry and timeout recovery.
8. **Reports and notifications need a user-flow acceptance pass.** Unit coverage exists for unread report count and view acknowledgement; verify the complete UI flow, including one-time report consumption and badge counts.
9. **Mobile UI acceptance is not represented by the current staging validation workflow.** Exercise key routes on narrow mobile viewports and verify navigation, layout, forms and match/report screens.
10. **Cross-system economy acceptance needs a season scenario.** Verify match rewards, season awards, market escrow/refunds, auction settlement and retry behavior together, with no duplicate credits/debits.

### P2 — post-stability improvements

11. Add operational observability and a concise incident runbook for scheduler failures, stuck leases, incomplete publication and failed cleanup.
12. Add performance/load checks for concurrent registration, match settlement and scheduled workers once functional gates are green.

## Quality Gate assessment

Existing checks are useful but split across workflows:
- staging-validation.yml: source checks, tests, Emulator scenarios and build;
- staging-health-check.yml: manual read-only application/Firestore health check;
- beta-season-one-preflight.yml: protected read-only Beta world diagnostics.

**Gap:** there is no single consolidated readiness report that combines source CI, emulator lifecycle acceptance, exact-commit Preview status, live read-only Beta preflight, and explicit PASS / BLOCKED / NOT CHECKED statuses.

The consolidated gate must remain read-only against live Beta. Destructive reset, archive restore and season activation tests belong only in isolated Emulator projects.

## Acceptance checklist

### Must pass before limited Beta opening

- [ ] Latest branch CI green on the exact release candidate commit.
- [ ] Vercel Preview READY for the exact same commit SHA.
- [ ] Authenticated read-only preflight confirms exact Beta project identity.
- [ ] 15 league tables, 120 slots, 840 canonical league fixtures and valid season timeline.
- [ ] Pyramid Cup has 120 unique entrants, 119 fixtures, no BYEs, 56 opening fixtures, eight D1 entrants in round two, valid frozen snapshots and BO3 final.
- [ ] Registration browser journey completes without stuck preloader or duplicate club creation.
- [ ] Core player journeys pass on desktop and mobile.
- [ ] No critical/high severity open defects affecting registration, matches, economy, Cup, archive or season lifecycle.
- [ ] Scheduled workers, secrets and scheduler inventory are verified read-only.
- [ ] No reset marker, stuck lease, incomplete cleanup or blocked transition.

### Must pass before Season 1 -> Season 2 can be trusted

- [x] Isolated Emulator seeds 840 finished Season 1 league fixtures (14 tours across 15 groups), runs rollover/archive and awards, then executes Season 2 calendar preparation, publication and activation. This is a lifecycle/data-integrity test, not 840 match-engine simulations. (CI #46007076460; isolated project)
- [ ] Isolated Emulator completes the 119-match Pyramid Cup and awards its BO3 final correctly.
- [ ] Archive contains exactly 840 validated league results and reconciled standings.
- [ ] Awards and economy ledger are idempotent under retry and partial recovery.
- [x] Season 2 prepared world contains 15 tables, 120 slots, 840 fixtures and a valid 120-team / 119-match no-BYE Cup in isolated Emulator. (CI #46007076460)
- [x] Atomic activation identity preservation and idempotent award/activation retry assertions pass in isolated Emulator. (CI #46007076460)
- [ ] Interrupted activation resumes safely; repeated invocation is idempotent.
- [ ] Only the immediately previous completed season remains in the visible archive policy.
- [x] Full lifecycle Emulator scenario verifies that only the immediately previous Season 1 archive remains and history cleanup is complete. (CI #46007076460)

## Source-of-truth and documentation drift

docs/ROADMAP.json still describes an older project phase model (version 1.0.61, last updated 2026-06-25) and lists economy tasks as pending. It does not represent the current user-approved roadmap or the present Beta Season 1 launch scope. Do not use it to infer current completion. Keep the user-approved roadmap unchanged; reconcile this stale document separately after confirming the canonical checklist.

## Next implementation sequence

1. Complete and harden the end-to-end Season 1 -> Season 2 Emulator acceptance flow, including actual calendar preparation, Cup preparation, publication, activation and archive cleanup.
2. Run full CI on the exact candidate SHA and inspect every Emulator assertion.
3. Obtain an exact-SHA Vercel Preview; the current Vercel build-rate limit has prevented this.
4. Run authenticated read-only Beta preflight only against that exact Preview; GET only.
5. Perform read-only Cloud Scheduler / Secret Manager inventory and browser/mobile journey checks.
6. Resolve all P0/P1 blockers before considering limited Beta access.

## Safety record

- No Production Firebase project was accessed or changed.
- No live Beta reset, restore, seed, or season activation was run.
- No deployment was initiated manually.
- PR #5 remains Draft and unmerged.

## Follow-up hardening — 2026-11-27

- Added a Firestore Emulator integration test to `tests/season-activation-emulator.integration.test.mjs`.
- The test performs the real atomic Season 1 -> Season 2 activation commit against disposable Emulator documents and asserts the human club profile, all ten owned-player identities, credits, occupied Season 1 slot ownership/generation, and a finished source-season fixture remain byte-for-byte unchanged.
- The test is included in the existing `test:registration:emulator` workflow command, so it runs in the main staging-validation job without touching shared Beta or Production data.
- The latest source CI run before this addition had passed TypeScript, core regression, full test suite, and registration Emulator tests; the Cup Emulator scenario was still running at the time of inspection. The follow-up commit must receive its own complete CI result before it is considered validated.

## Follow-up validation — 2026-11-27 (latest tested head)

- Latest branch head at this validation: `3cd46051482f6231542ee289145d4361c5d66636`.
- GitHub Actions run [#46004523132](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46004523132) completed with conclusion **success** on that exact SHA.
- All three workflow jobs passed: main TypeScript/tests/production build; separate Control app validation; consolidated Beta Quality Gate.
- This run executes the strengthened Season 1 -> Season 2 identity-preservation Emulator test added to `tests/season-activation-emulator.integration.test.mjs`.
- Vercel checks for this SHA were blocked by the account's build-rate limit. No exact-SHA Preview was established; this is an infrastructure/plan limit, not a source CI failure. The older READY Preview for `7c419c8` is not evidence for the current SHA.
- Therefore source/Emulator validation is **PASS**, while exact-SHA Preview, live read-only Beta preflight, scheduler/secret inventory, browser journeys and mobile journeys remain **NOT CHECKED**. The overall release decision remains **NO-GO** until P0/P1 operational gates are evidenced.
- No live Beta or Production database was read or mutated; no deployment, reset, restore, seed or season activation was initiated. PR #5 remains Draft and unmerged.

## Full-season Emulator acceptance — 2026-11-27

- Added `tests/season-one-to-two-lifecycle-emulator.integration.test.mjs` and wired it into `test:registration:emulator`.
- The new isolated `demo-forge-rivals` Emulator scenario constructs all 15 canonical groups and 840 finished Season 1 league fixtures across 14 tours, invokes the real `prepareSeasonRollover`, and verifies the completed 840-match archive, 15-group standings/placement plan, and idempotent human-club award ledger/trophies.
- It then exercises the actual `commitSeasonActivation` Firestore transaction for the immediate Season 2 successor and verifies duplicate activation is rejected and Season 1 profile, balance, trophies, occupied slot/generation, and completed fixture remain intact.
- The test deliberately seeds a prepared/published Season 2 boundary before calling the atomic activation transaction. It does not claim to exercise the full live calendar builder/publication orchestration; calendar preparation and publication retain their separate unit/Emulator coverage.
- Exact-head CI run [#46005551101](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46005551101) for commit `9432757963cac8d4e8f49e295283f403926fa891` completed **success** across main app, Control app, and consolidated Quality Gate. This includes the new lifecycle Emulator scenario.
- Release status remains **NO-GO**: exact-SHA Vercel Preview, authenticated read-only live Beta preflight, and live Cloud Scheduler/Secret Manager inventory are still not evidenced. Browser/mobile journeys also remain outstanding.
- No live Beta or Production database was mutated; no deploy, reset, restore, seed, or season activation was initiated. PR #5 remains Draft and unmerged.


## Follow-up validation — full-season acceptance expansion (2026-11-27)

- Commit `9432757963cac8d4e8f49e295283f403926fa891` passed GitHub Actions run [#46005551101](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46005551101) with all three jobs successful.
- The new `tests/season-one-to-two-lifecycle-emulator.integration.test.mjs` runs the real `prepareSeasonRollover` and atomic activation commit against disposable namespaced Emulator documents. It verifies 840 league results, a complete S1 archive, 15-group rollover plan, award ledger and trophies, human club/profile/slot identity, and duplicate activation rejection.
- Further expanded coverage in `tests/full-season-one-to-two-emulator.integration.test.mjs` to exercise the actual public lifecycle functions: `ensureSeasonCalendar(2)`, `publishPreparedSeason()`, and `activatePublishedSeason()`. The test uses its own disposable Firestore Emulator project `demo-forge-rivals-season-lifecycle-test` and asserts S2 has 15 tables, 120 slots, 840 fixtures, a fully prepared 120-participant / 119-match no-BYE Pyramid Cup, and the retained S1 archive after activation/cleanup.
- Added `test:season:lifecycle:emulator` and wired the new isolated full lifecycle scenario into `.github/workflows/staging-validation.yml`.
- Latest commit at this note: `d269c1c8f726466057b3779a06ef8306b08b757f`; CI run [#46006637114](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46006637114) is queued/pending. The expanded full public-lifecycle scenario is **NOT YET VALIDATED** until this exact SHA completes green CI.
- Exact-SHA Vercel Preview, live read-only Beta preflight, infrastructure inventory, browser journeys and mobile journeys remain **NOT CHECKED**. Overall release verdict remains **NO-GO**.
- No live Beta or Production data was read or mutated; no deployment, reset, restore, seed or activation was initiated. PR #5 remains Draft and unmerged.


## Full public lifecycle acceptance — CI verified (2026-11-27)

- Exact branch head: `a90f1bd23cfb767b173f633b6bb1344051d88fa6`.
- GitHub Actions run [#46007076460](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46007076460) completed with conclusion **success** on that exact SHA. Main app, separate Control app, and consolidated Beta Quality Gate all passed.
- Confirmed successful steps include TypeScript, core regression, full test suite, Firestore Emulator registration transactions, Pyramid Cup prepared-season Emulator, Fresh Season 1 reset Emulator, full Season 1 -> Season 2 lifecycle Emulator acceptance, and main/Control production builds.
- The previously observed `server-only` test-discovery failure was resolved by keeping the public lifecycle scenario out of generic `tests/*.test.mjs` discovery and invoking it only through the dedicated `test:season:lifecycle:emulator` command with `--conditions=react-server`.
- This validates source and isolated Emulator flows only. Exact-SHA Vercel Preview is not established; authenticated read-only live Beta preflight, Cloud Scheduler/Secret Manager inventory, and browser/mobile journeys remain **NOT CHECKED**. Overall release verdict remains **NO-GO** until operational gates pass.
- No live Beta or Production data was read or mutated; no deployment, reset, restore, seed or season activation was initiated. PR #5 remains Draft and unmerged.
