'use server';

import { requireAdminActor } from '@/lib/server-auth';
import { initializeLeagueWorld } from './world-engine';
import { totalNuclearResetV131 } from './nuclear-reset';
import { resolveDailyMatches } from './autonomous-cycle';

/** Browser-facing administrative actions. Worker functions remain server-only. */
export async function initializeLeagueWorldAction(idToken: string, leagueId: string, seasonNumber?: number) {
  await requireAdminActor(idToken);
  return initializeLeagueWorld(leagueId, seasonNumber);
}

export async function totalNuclearResetAction(idToken: string) {
  await requireAdminActor(idToken);
  return totalNuclearResetV131();
}

export async function resolveDailyMatchesAction(idToken: string) {
  await requireAdminActor(idToken);
  return resolveDailyMatches();
}
