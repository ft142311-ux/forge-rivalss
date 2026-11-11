import 'server-only';


/**
 * Legacy compatibility wrapper.
 * Canonical world generation is owned by ensureSeasonCalendar().
 * This prevents the old world engine from generating a second, incompatible calendar.
 */
import { ensureSeasonCalendar } from './season-calendar';

export async function initializeLeagueWorld(leagueId: string, targetSeason?: number) {
  if (leagueId !== 'ALPHA') {
    return { status: 'UNSUPPORTED_LEAGUE', isComplete: false, error: 'Only canonical ALPHA league is supported.' };
  }
  const result = await ensureSeasonCalendar();
  return {
    status: result.worldReady ? 'COMPLETE' : 'BUILDING',
    isComplete: result.worldReady,
    currentIndex: result.worldReady ? 15 : 0,
    progress: result.worldReady ? 'Canonical season world ready' : 'Canonical world is still building',
    ...result,
  };
}
