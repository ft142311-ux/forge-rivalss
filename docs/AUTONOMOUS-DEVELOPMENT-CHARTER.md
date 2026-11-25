# Forge-Rivals Autonomous Development Charter

**Mode:** High autonomy  
**Canonical repository:** `ft142311-ux/forge-rivalss`  
**Allowed working branch:** `feature/beta-fresh-season-one`  
**Allowed Firebase project:** `forge-rivals-beta` (Beta only; region `eur3`)

## Mission

Continuously improve the Forge-Rivals Beta game and its separate Control application without requiring the owner to invent every next task. Prefer the highest-impact, smallest safe change that can be verified.

## Mandatory boundaries

- Never modify `main`, Production deployment settings, Production secrets, or Production Firebase.
- Never switch Firebase project targets away from `forge-rivals-beta` in Control or Beta-only tooling.
- Never run destructive database operations, world resets, data migrations against a live database, admin-claim changes, account changes, or production deployments without explicit owner approval.
- Do not treat access to GitHub/Vercel as access to Firebase credentials or a live database. Use Firebase Emulator for integration tests. Live Beta access, when separately configured, is read-only unless the owner explicitly authorizes a specific write.
- Never commit secrets, service-account JSON, API tokens, `.env` files, private keys, or user data. Public Firebase web configuration is not an Admin credential.
- Keep Control as an independent Next.js application under `apps/control`, deployed as a separate Vercel project. Do not import the game root layout/providers into Control.
- Do not merge into `main` or promote Production.

## Autonomous work loop

1. Inspect the current branch, recent commits, open pull requests, GitHub Actions checks, and Vercel Preview deployments.
2. Review the game core, security boundaries, Control application, and existing user-reported defects.
3. Select one bounded task by severity, player impact, security impact, and regression risk. Avoid broad refactors without a written plan.
4. Implement the change only on `feature/beta-fresh-season-one`. Keep each commit focused and explain the intent.
5. Add or update regression tests. Run available checks in a safe local/CI environment; use Firebase Emulator for database integration tests.
6. Inspect CI and Preview results. If a check fails, diagnose and fix it before claiming completion. If the available tools cannot run a check, state that limitation.
7. Report commit SHA, changed files, checks with their actual status, unresolved risks, and the next highest-priority task.
8. Continue with another independent safe task only when doing so does not hide or compound a failing check.

## Priority order

1. Security, authentication, authorization, Firestore rules, and protection against cross-project/Production access.
2. Beta world stability: initialization, season lifecycle, match scheduling/resolution, tournament integrity, and recovery safety.
3. Player-facing correctness: reports/unread state, match center, rosters, transfers, economy, and notifications.
4. Independent Control app: secure sign-in, Beta-only read-only diagnostics, auditability, and operational visibility.
5. Performance, reliability, accessibility, and UI polish after core correctness.

## Approval gates

Owner approval is required before:
- any live Firestore write, reset, seed, migration, or destructive action;
- granting/revoking admin claims or changing allowlists;
- changing Firebase/Vercel Production settings or deploying/promoting Production;
- merging a pull request into `main`;
- introducing paid services, new recurring spend, or materially broader access permissions.

## Completion standard

A task is complete only when the code change is committed on the allowed branch, relevant tests/checks have evidence, and the report distinguishes verified results from unverified assumptions. Never fabricate CI, emulator, Firebase, or Vercel results.