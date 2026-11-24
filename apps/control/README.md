# Forge-Rivals Control

Independent administrative application. Deploy as a separate Vercel project with **Root Directory** set to `apps/control`; do not attach this app to the player-facing Forge-Rivals deployment.

## Isolation and access
- Separate Next.js build, routes, UI, deployment and domain.
- No imports from the game app and no game providers/layout.
- Firebase ID tokens are verified server-side with revocation checking.
- Every API request requires both the Firebase `admin: true` custom claim and a UID in `CONTROL_ADMIN_UIDS`.
- Server project must be exactly `forge-rivals-beta`; Admin SDK service-account project must match.
- Browser receives only public Firebase configuration; Admin SDK credentials stay server-side.

## Environment
Copy `.env.example` into the separate Vercel project's Preview environment. Set Firebase public configuration, `GCLOUD_PROJECT=forge-rivals-beta`, `FIREBASE_ADMIN_SDK` for the Beta service account, and `CONTROL_ADMIN_UIDS` to the approved administrator UID(s). Never configure Production credentials here.

## Local
`npm install`, `npm run dev`. Set environment values in `.env.local`.

The first version is read-only: network/world health, aggregate player counts and season/Cup summary. Destructive controls are deliberately not exposed until audit logging, per-action authorization and explicit confirmation are implemented.
