import 'server-only';

import { resolveDailyMatches } from './autonomous-cycle';

/**
 * Stage 3A.8.1 — one-shot catch-up for an active season.
 *
 * It intentionally does not recreate schedules or touch already finished
 * matches. It only asks the authoritative autonomous resolver to process every
 * currently due match and rebuild standings from finished matches.
 */
export async function catchUpSeasonResults() {
  return resolveDailyMatches();
}
