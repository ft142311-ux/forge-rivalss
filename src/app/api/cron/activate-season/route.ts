import { handleSeasonActivation } from '../season-activation-handler';

/** Canonical authenticated endpoint for official season activation. */
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleSeasonActivation(request, {
    logLabel: '[CRON SEASON ACTIVATION ERROR]:',
    errorCode: 'SEASON_ACTIVATION_FAILED',
  });
}
