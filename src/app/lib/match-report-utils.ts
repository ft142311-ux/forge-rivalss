/**
 * Pure presentation helpers shared by Match Preview, live text broadcast and
 * post-match statistics. These helpers only normalize already-stored results;
 * they never simulate a match or modify its outcome.
 */

export type MatchReportScore = { home: number; away: number };

export function resolveMatchSimulation(matchData: any): any | null {
  if (!matchData) return null;
  return matchData.simulation || {
    games: matchData.games || [matchData],
    seriesScore: matchData.seriesScore || `${matchData.scoreA ?? matchData.homeScore ?? 0}-${matchData.scoreB ?? matchData.awayScore ?? 0}`,
    winner: matchData.winner,
    isTbdWin: matchData.isTbdWin,
  };
}

export function parseMatchSeriesScore(rawScore: any, matchData: any): MatchReportScore {
  if (rawScore && typeof rawScore === 'object') {
    const home = Number(rawScore.home ?? rawScore.homeScore ?? rawScore.scoreA);
    const away = Number(rawScore.away ?? rawScore.awayScore ?? rawScore.scoreB);
    if (Number.isFinite(home) && Number.isFinite(away)) return { home, away };
  }

  const raw = String(rawScore ?? '').replace(/[–—]/g, '-');
  const match = raw.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (match) return { home: Number(match[1]), away: Number(match[2]) };

  return {
    home: Number(matchData?.scoreA ?? matchData?.homeScore ?? 0),
    away: Number(matchData?.scoreB ?? matchData?.awayScore ?? 0),
  };
}

export function normalizeMatchTimeline(game: any): any[] {
  const rawTimeline = Array.isArray(game?.timeline) ? game.timeline : [];
  return rawTimeline
    .filter((event: any) => event != null)
    .map((event: any, index: number) => {
      const source = typeof event === 'object' ? event : { text: String(event) };
      return {
        ...source,
        minute: source?.minute ?? source?.time ?? source?.timestamp ?? `${index + 1}:00`,
        text: source?.text ?? source?.description ?? source?.message ?? String(event ?? ''),
      };
    })
    .filter((event: any) => event.text !== '');
}

export function getCompletedSeriesScore(games: any[], completedGameCount: number): MatchReportScore {
  const completedGames = Array.isArray(games) ? games.slice(0, Math.max(0, completedGameCount)) : [];
  return completedGames.reduce((score, game) => ({
    home: score.home + Number(game?.homeScore || 0),
    away: score.away + Number(game?.awayScore || 0),
  }), { home: 0, away: 0 });
}
