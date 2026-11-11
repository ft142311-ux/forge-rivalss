import { handleSeasonActivation } from '../season-activation-handler';

/** Backward-compatible URL; shares the canonical season activation handler. */
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleSeasonActivation(request, {
    logLabel: '[CRON SEASON TRANSITION ERROR]:',
    errorCode: 'SEASON_TRANSITION_FAILED',
  });
}
