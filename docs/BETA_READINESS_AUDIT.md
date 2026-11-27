# Forge-Rivals Beta readiness audit

**Audit date:** 2026-11-27  
**Repository:** ft142311-ux/forge-rivalss  
**Branch:** feature/beta-fresh-season-one  
**Audited head:** 7c419c8dbd08175bb9f95f6303c13c4867686ca7  
**Firebase target:** forge-rivals-beta (Firestore region eur3)  
**Scope:** read-only source/workflow audit and review of recorded CI evidence. No live Firebase reads, writes, resets, deployments, or season activations were performed for this audit.

## Executive decision

**Current decision: NO-GO for opening Beta to players until the P0 gates below are evidenced.**

The codebase has substantial automated coverage and the latest branch validation is green, but green CI is not equivalent to a verified live Beta world or a completed end-to-end Season 1 lifecycle.

The readiness percentage is a planning estimate, not a test metric:

- **75% estimated overall implementation/readiness**
- **Build and automated branch validation:** green on the audited head
- **Live Beta readiness:** not established by this audit
- **Full Season 1 -> Season 2 end-to-end acceptance:** not yet evidenced by a single isolated Emulator scenario

Do not interpret the percentage as permission to reset, seed, publish, or activate a live season.

## Verified evidence

### Latest CI

GitHub Actions run [#1994](https://github.com/ft142311-ux/forge-rivalss/actions/runs/46002245961), push event for audited head 7c419c8, completed successfully.

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
2. **No single combined Season 1 lifecycle Emulator acceptance scenario found.** Important distinction: the existing Pyramid Cup Emulator test does drive the complete 119-match bracket, checks the BO3 final, prize ledger, trophy repair and idempotent retries; the clean Season 1 Emulator scenario separately verifies the 15/120/840 world and pre-season Cup creation. The gap is the combined end-to-end path that simulates all 14 league rounds, completes all 119 Cup matches, validates final league awards/archive, prepares and activates Season 2, and retries the transition safely in one isolated scenario.
3. **Season 1 -> Season 2 operational acceptance remains unproven.** Need explicit proof of sequential activation, lock/lease recovery, no duplicate fixtures/awards, preserved human clubs and players, and cleanup completion.
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

- [ ] Isolated Emulator completes all 14 league rounds and validates all 840 results.
- [ ] Isolated Emulator completes the 119-match Pyramid Cup and awards its BO3 final correctly.
- [ ] Archive contains exactly 840 validated league results and reconciled standings.
- [ ] Awards and economy ledger are idempotent under retry and partial recovery.
- [ ] Season 2 prepared world contains 15 tables, 120 slots, 840 fixtures and a valid 120-team Cup.
- [ ] Activation preserves human club/player identities and does not duplicate matches, awards or rollover records.
- [ ] Interrupted activation resumes safely; repeated invocation is idempotent.
- [ ] Only the immediately previous completed season remains in the visible archive policy.
- [ ] History cleanup completes and no cleanup/transition fence remains active.

## Source-of-truth and documentation drift

docs/ROADMAP.json still describes an older project phase model (version 1.0.61, last updated 2026-06-25) and lists economy tasks as pending. It does not represent the current user-approved roadmap or the present Beta Season 1 launch scope. Do not use it to infer current completion. Keep the user-approved roadmap unchanged; reconcile this stale document separately after confirming the canonical checklist.

## Next implementation sequence

1. Build the consolidated, non-destructive Quality Gate report with explicit PASS / FAIL / BLOCKED / NOT CHECKED statuses and commit/Preview identity.
2. Add the missing isolated Emulator full-season acceptance scenario, reusing existing test fixtures and lifecycle functions rather than inventing game rules.
3. Add focused integration assertions for archive retention, awards/ledger idempotency, preserved human identities and repeated Season 2 activation.
4. Run the complete branch CI and inspect all failures on the exact new head.
5. Run the authenticated live Beta preflight only after confirming the matching Preview URL and commit; GET only.
6. Resolve P0 defects before considering limited Beta access.

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
