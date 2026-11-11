# Forge-Rivals Stage 7 — Match Report UI

This is a UI/reporting patch for the already-installed Stage 6 Match Core v2.
It does not rebuild the league, delete Firestore data, or change match simulation formulas.

## Changed

- `src/app/match/page.tsx`

## Match Preview

- team names and logos
- team OVR
- deterministic viewer count
- tour/BO2 information
- result hidden until the report is watched

## Live Text Broadcast

- two-column layout: Home left / Away right
- uses starting-roster player names when available
- player photos from `players_v14`
- events are generated from the stored Stage 6 simulation result and are therefore presentation-only, not a second simulation
- map result is revealed only after the event sequence for that map finishes
- final BO2 result is shown only in post-match statistics

## Post-Match Statistics

- BO2 final result
- team OVR and average simulated strength
- team cohesion
- role-by-role comparison
- player cards with photo, role, OVR and simulated impact
- key moments by map
- calculated loss-analysis block based on the largest losing role gap

## Important

Apply this patch on top of the version where Stage 6 Match Core v2 is already installed.
No database reset is required.

Run after installation:

```powershell
npm run typecheck
```
