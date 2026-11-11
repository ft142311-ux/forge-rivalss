# Forge-Rivals — guarded local Season 1 reset

This patch replaces `scripts/reset-and-build-local-world.js`. It targets the Firebase Emulator only. It does not connect to production.

## Safety behavior
- Default mode is **dry-run**; no writes occur.
- Refuses to run unless `FIRESTORE_EMULATOR_HOST` is `127.0.0.1:8080` or `localhost:8080`.
- Requires `--backup-verified` alongside `--apply`.
- Deletes only `matches_v2`, `league_tables_v2`, and `league_slots_v1`.
- Preserves `players_v14`, the `global_stats` collection, Auth Emulator accounts, and other `system_v1` documents.
- Replaces only `system_v1/season_config`; all other `system_v1` documents are preserved.
- Sets Season 1 start to `2026-10-23T15:00:00.000Z` (18:00 MSK) and Season 2 start to `2026-11-09T15:00:00.000Z`.
- Seeds bot slots as OCCUPIED with matching bot IDs, rather than FREE/null.

## Run
1. Stop any application processes that might write to the emulator. Keep the emulator running.
2. Export the emulator to a new backup directory using the Firebase CLI, for example:
   `firebase emulators:export .\emulator-data-backup-before-s1-reset-20261022 --project studio-2788872209-f7092`
3. Set the local host explicitly in the same PowerShell session:
   `$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'`
   `$env:GCLOUD_PROJECT = 'studio-2788872209-f7092'`
4. Preview first:
   `node .\scripts\reset-and-build-local-world.js`
5. Review counts and backup contents. Only then apply:
   `node .\scripts\reset-and-build-local-world.js --apply --backup-verified`

`--backup-verified` is an explicit operator acknowledgement; the script does not itself cryptographically validate the backup. Never run against a production Firestore endpoint.

## Important limitation
The script preserves player documents to avoid deleting user/club data. It is a world reset for canonical league fixtures/tables/slots, not a universal cleanup of every historical player stat or unrelated collection. A follow-up integrity pass must verify user-owned clubs and roster links before deciding whether any player fields need a targeted season-stat reset.

## Expected counts
- 15 league tables
- 120 league slots
- 840 fixtures
- Auth accounts preserved
