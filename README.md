# Forge-Rivals — canonical local development world

> **Important:** older reset instructions in this file have been superseded. Do not run historical reset commands, import an old emulator export, or overwrite the canonical world as part of routine development.

## Canonical world

The current canonical development world is `CLEAN_S1_V1`, created in the local Firebase Emulator project `demo-forge-rivals`.

- Active season: Season 1
- Phase at creation: `REGULAR_SEASON`
- Season 1 start: `2026-11-09T15:00:00.000Z` (18:00 MSK)
- League structure: 15 groups/tables across four divisions
- League slots: 120
- Canonical league fixtures: 840
- Firebase Auth and Firestore are accessed through the local Emulator Suite for development and tests

The existing canonical-world backup/export is retained as the recovery point. Do not replace it or restore a different export without a fresh backup and explicit approval.

## Development safety rules

1. Work against the local Firebase Emulator project `demo-forge-rivals` for gameplay development and integration testing.
2. Do not connect development scripts to Firebase Production.
3. Do not reset, reseed, or import data into the canonical world during ordinary feature work.
4. Any future destructive world operation requires a new verified emulator export and explicit approval before execution.
5. Registration must claim an existing canonical league slot; it must not generate tables, slots, or fixtures.
6. Season transitions must use the guarded prepare → publish → activate lifecycle. Do not bypass the canonical archive, rollover-plan, or cleanup fences.

## Emulator endpoints

| Service | Local endpoint |
|---|---|
| Authentication | `127.0.0.1:9099` |
| Firestore | `127.0.0.1:8080` |
| Functions | `127.0.0.1:5001` |
| Emulator UI | `http://127.0.0.1:4000` |

## Scheduled server tasks

- Season orchestrator: every 5 minutes UTC
- Inactive-club retirement sweep: daily at 03:15 UTC
- Transfer-market and player-auction expiry: every 5 minutes UTC

Protected scheduled routes require the shared `CRON_SECRET`, stored in Firebase Secret Manager. Never commit the secret or service-account credentials.

## Beta validation baseline

- TypeScript check
- Core regression tests
- Full test suite
- Firebase Emulator registration transactions
- Production build

CI validation is not a deployment. The working branch and draft pull request must remain unmerged until explicitly approved.
