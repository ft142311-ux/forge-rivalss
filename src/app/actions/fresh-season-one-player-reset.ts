export type FreshSeasonOnePlayer = Record<string, any>;

const EMPTY_SEASON_STATS = {
  matches: 0,
  wins: 0,
  successfulActions: 0,
  warnings: 0,
  disqualifications: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  postMatchRating: 0,
};

const SEASON_ONE_LEAGUE_MATCH_PREFIX = 'match_v140_S1_LALPHA_';

function isSeasonOneCompetitionMatchId(value: unknown) {
  const id = String(value || '');
  return id.startsWith(SEASON_ONE_LEAGUE_MATCH_PREFIX) ||
    /^cup_S1_/.test(id) ||
    /^match_v\\d+_S1_/.test(id);
}

/**
 * Clears only competition-season counters and transient references for the
 * fresh Season 1. Player identity, roster membership, development, condition,
 * contracts, XP, finances, lifetime statistics and unrelated trophies remain.
 */
export function resetFreshSeasonOnePlayerState<T extends FreshSeasonOnePlayer>(player: T): T {
  const seasonAwards = player.seasonAwards && typeof player.seasonAwards === 'object'
    ? { ...player.seasonAwards }
    : {};
  delete seasonAwards.S1;

  const trophies = Array.isArray(player.trophies)
    ? player.trophies.filter((trophy: any) => {
        const isSeasonOneLeagueAward = trophy?.id === 'league-cup-season-1' &&
          trophy?.type === 'league_champion';
        const isSeasonOnePyramidAward = trophy?.id === 'pyramid-cup-season-1' &&
          trophy?.type === 'pyramid_cup_champion';
        return !isSeasonOneLeagueAward && !isSeasonOnePyramidAward;
      })
    : player.trophies;

  const matchEconomy = player.matchEconomy && typeof player.matchEconomy === 'object'
    ? Object.fromEntries(Object.entries(player.matchEconomy).filter(([matchId]) =>
        !String(matchId).startsWith(SEASON_ONE_LEAGUE_MATCH_PREFIX)))
    : player.matchEconomy;

  const lastMatchConsequences = isSeasonOneCompetitionMatchId(player.lastMatchConsequences?.matchId)
    ? null
    : player.lastMatchConsequences;

  return {
    ...player,
    seasonStats: { ...EMPTY_SEASON_STATS },
    chemistryMatches: 0,
    lineupMatches: 0,
    lastMatchMinutes: 0,
    lastMatchId: null,
    lastMatchOfficial: false,
    warningCount: 0,
    suspensionUntil: null,
    seasonAwards,
    trophies,
    matchEconomy,
    lastMatchEconomy: null,
    lastMatchConsequences,
  };
}
