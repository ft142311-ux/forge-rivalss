export type FreshSeasonOnePlayer = Record<string, any>;
export type FreshSeasonOneClubProfile = Record<string, any>;

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
    id.startsWith('cup_S1_') ||
    /^match_v\d+_S1_/.test(id);
}

/**
 * Clears only an individual player's competition-season counters and discipline.
 * Development, identity, condition, injuries, contracts, XP and career totals stay.
 */
export function resetFreshSeasonOnePlayerState<T extends FreshSeasonOnePlayer>(player: T): T {
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
  };
}

/**
 * Clears the club-level Season 1 awards and stale match references while
 * applying the player-level reset to each owned player. Club identity,
 * credentials, roster membership, finances, facilities, tactics and lineup stay.
 */
export function resetFreshSeasonOneClubProfileState<T extends FreshSeasonOneClubProfile>(profile: T): T {
  const seasonAwards = profile.seasonAwards && typeof profile.seasonAwards === 'object'
    ? { ...profile.seasonAwards }
    : {};
  delete seasonAwards.S1;

  const trophies = Array.isArray(profile.trophies)
    ? profile.trophies.filter((trophy: any) =>
        !(
          (trophy?.id === 'league-cup-season-1' && trophy?.type === 'league_champion') ||
          (trophy?.id === 'pyramid-cup-season-1' && trophy?.type === 'pyramid_cup_champion')
        ))
    : profile.trophies;

  const matchEconomy = profile.matchEconomy && typeof profile.matchEconomy === 'object'
    ? Object.fromEntries(Object.entries(profile.matchEconomy).filter(([matchId]) => {
        const id = String(matchId);
        return !id.startsWith(SEASON_ONE_LEAGUE_MATCH_PREFIX) && !id.startsWith('cup_S1_');
      }))
    : profile.matchEconomy;

  const lastMatchConsequences = isSeasonOneCompetitionMatchId(profile.lastMatchConsequences?.matchId)
    ? null
    : profile.lastMatchConsequences;

  const lastMatchEconomy = isSeasonOneCompetitionMatchId(profile.lastMatchId)
    ? null
    : profile.lastMatchEconomy;

  const ownedPlayers = Array.isArray(profile.ownedPlayers)
    ? profile.ownedPlayers.map((player: FreshSeasonOnePlayer) => resetFreshSeasonOnePlayerState(player))
    : profile.ownedPlayers;

  return {
    ...profile,
    ownedPlayers,
    seasonAwards,
    trophies,
    matchEconomy,
    lastMatchEconomy,
    lastMatchConsequences,
  };
}
