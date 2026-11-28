# Forge-Rivals Control

Independent administrative application. Deploy as a separate Vercel project with **Root Directory** set to `apps/control`; never attach it to the player-facing deployment.

## Isolation and access
- Separate Next.js build, routes, UI, deployment and domain.
- Firebase ID tokens are verified server-side with revocation checking.
- Every privileged API request requires the Firebase `admin: true` custom claim.
- Server project and Admin SDK service-account project are hard-pinned to `forge-rivals-beta`.
- Browser receives only public Firebase configuration; Admin SDK credentials and bootstrap secret stay server-side.
- The first administrator is created through a one-time bootstrap endpoint. A Firestore lock prevents a second registration.
- After bootstrap, remove `BOOTSTRAP_ADMIN_SECRET` from the Vercel Preview environment and redeploy. The bootstrap endpoint then remains disabled.
- Never configure Production credentials here.

## Preview environment
Set these variables in the separate Control Vercel project, Preview environment only:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID=forge-rivals-beta`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `GCLOUD_PROJECT=forge-rivals-beta`
- `FIREBASE_ADMIN_SDK` — Beta service-account JSON
- `BOOTSTRAP_ADMIN_SECRET` — random secret of at least 32 characters

Enable Email/Password sign-in in Firebase Authentication for the **Beta** project. Open the Control Preview URL, create the administrator once, then remove the bootstrap secret from Vercel and redeploy. Use a unique password of at least 12 characters.

## Local
`npm install`, `npm run dev`. Set environment values in `.env.local`.

The initial panel is read-only: network/world health, aggregate player counts and season/Cup summary. Destructive controls are deliberately not exposed until audit logging, per-action authorization and explicit confirmation are implemented.
