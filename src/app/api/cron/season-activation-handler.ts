import { NextResponse } from 'next/server';
import { activateNextSeason } from '@/app/actions/season-cycle';
import { cronResultStatus } from './cron-result';
import { isCronAuthorized } from './cron-auth';

type SeasonActivationRouteOptions = {
  logLabel: string;
  errorCode: string;
};

/** Shared implementation for the two legacy season-activation URLs. */
export async function handleSeasonActivation(
  request: Request,
  options: SeasonActivationRouteOptions,
) {
  if (!isCronAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const result = await activateNextSeason();
    return NextResponse.json(
      { ...result, timestamp: new Date().toISOString() },
      { status: cronResultStatus(result) },
    );
  } catch (error: unknown) {
    console.error(options.logLabel, error);
    return NextResponse.json(
      { success: false, error: options.errorCode },
      { status: 500 },
    );
  }
}
