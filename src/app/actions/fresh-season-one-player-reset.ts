import { generateUniquePlayer, type Player, type Role } from '../lib/moba-data';

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

  const lastMatchId = isSeasonOneCompetitionMatchId(profile.lastMatchId)
    ? null
    : profile.lastMatchId;
  const lastMatchEconomy = lastMatchId === null
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
    lastMatchId,
    lastMatchEconomy,
    lastMatchConsequences,
  };
}


export function getFreshSeasonOneClubName(uid: string) {
  const suffix = String(uid || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  if (!suffix) throw new Error('FRESH_CLUB_ACCOUNT_UID_INVALID');
  return `New Club ${suffix}`;
}

export type FreshSeasonOneClubPlacement = {
  tier: number;
  group: number;
  rank: number;
};

/**
 * Creates a genuinely new human club while retaining the Firebase UID and
 * account-facing identity. The caller must replace the existing players_v14
 * document (not merge this object) and must never delete the Firebase Auth user.
 */
export function createFreshSeasonOneHumanClubProfile(
  account: Record<string, any>,
  placement: FreshSeasonOneClubPlacement,
  seasonNumber = 1,
  now = new Date(),
) {
  const uid = String(account.id || '');
  if (!uid || uid.startsWith('BOT_')) throw new Error('FRESH_CLUB_ACCOUNT_UID_INVALID');
  if (![placement.tier, placement.group, placement.rank].every(Number.isInteger) ||
      placement.tier < 1 || placement.tier > 4 ||
      placement.group < 1 || placement.group > 2 ** (placement.tier - 1) ||
      placement.rank < 1 || placement.rank > 8 ||
      seasonNumber !== 1 || !Number.isFinite(now.getTime())) {
    throw new Error('FRESH_CLUB_PLACEMENT_INVALID');
  }

  const clubName = getFreshSeasonOneClubName(uid);
  const roles: Role[] = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support', 'Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];
  // Deterministic for the same account and reset timestamp, so a journal retry
  // recreates the exact same player IDs instead of minting duplicate rosters.
  const rosterSeed = `fresh_s1_${uid}_${now.getTime()}`;
  const ownedPlayers: Player[] = roles.map((role, index) => ({
    ...generateUniquePlayer(role, index, true, `${rosterSeed}_${index}`),
    hiredAt: now.toISOString(),
  }));
  const byRole = (role: string) => ownedPlayers.find(player => player.role === role)?.id || null;
  const lineup: Record<string, string | null> = {
    carry: byRole('Carry'),
    mid: byRole('Midlaner'),
    offlane: byRole('Tank'),
    support: byRole('Jungler'),
    full_support: byRole('Support'),
    sub_carry: ownedPlayers.filter(player => player.role === 'Carry')[1]?.id || null,
    sub_mid: ownedPlayers.filter(player => player.role === 'Midlaner')[1]?.id || null,
    sub_offlane: ownedPlayers.filter(player => player.role === 'Tank')[1]?.id || null,
    sub_support: ownedPlayers.filter(player => player.role === 'Jungler')[1]?.id || null,
    sub_full_support: ownedPlayers.filter(player => player.role === 'Support')[1]?.id || null,
    res1: null, res2: null, res3: null, res4: null, res5: null,
    res6: null, res7: null, res8: null,
  };

  return {
    id: uid,
    email: String(account.email || ''),
    displayName: clubName,
    clubName,
    country: 'International',
    numericId: Number(account.numericId || 0),
    credits: 1_000_000,
    crystals: 50,
    experiencePoints: 0,
    managerLevel: 1,
    selectedLeagueId: 'ALPHA',
    leagueLevel: placement.tier,
    groupId: placement.group,
    rank: placement.rank,
    ownedPlayers,
    lineup,
    staff: { coach: null, analyst: null, scout: null, doctor: null, financier: null },
    strategy: 'Balanced Play',
    arena: { capacity: 5000, pressCenterLevel: 1, cafeLevel: 1, shopLevel: 1 },
    hq: { hrLevel: 1, financeLevel: 1 },
    bootcamp: { bootcampLevel: 1 },
    academy: { scoutsLevel: 1 },
    medical: { massageLevel: 1 },
    lastProcessedSeason: 1,
    rewardDay: 1,
    lastLoginDate: now.toISOString(),
    createdAt: now.toISOString(),
    version: 140,
  };
}
