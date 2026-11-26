/** Firestore storage boundaries for match modes. These collections must never be mixed. */
export const MATCH_COLLECTIONS = {
  league: 'matches_v2',
  cup: 'cup_matches',
  tournament: 'tournament_matches_v1',
  friendly: 'friendly_matches_v1',
  trial: 'training_matches_v1',
  training: 'training_matches_v1',
  association: 'association_matches_v1',
  'cw-basket': 'association_matches_v1',
} as const;

export type MatchStorageMode = keyof typeof MATCH_COLLECTIONS;

export function getMatchCollectionName(mode: MatchStorageMode): string {
  return MATCH_COLLECTIONS[mode];
}

/** Collections searched by the Match Center when opening a report by ID. */
export const MATCH_REPORT_COLLECTIONS = [
  MATCH_COLLECTIONS.league,
  MATCH_COLLECTIONS.cup,
  MATCH_COLLECTIONS.friendly,
  MATCH_COLLECTIONS.association,
  MATCH_COLLECTIONS.tournament,
  MATCH_COLLECTIONS.trial,
] as const;
