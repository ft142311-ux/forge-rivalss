/**
 * Explicit source allowlist for a recoverable Season 1 snapshot.
 * Pure validation only: no Firestore reads or writes occur in this module.
 */
export type SeasonOneArchiveSource = {
  path: string;
  data: Record<string, any>;
};

export type SeasonOneArchiveEntry = {
  sourcePath: string;
  sourceCollection: string;
  sourceId: string;
  data: Record<string, any>;
};

const EXACT_DOCUMENT_PATHS = new Set([
  'cup_pyramid_v1/cup_s1_lALPHA',
  'league_season_archives_v1/S1',
  'league_season_rollovers_v1/S2',
  'league_season_history_v1/S1',
]);

const DOCUMENT_COLLECTIONS = new Set([
  'league_tables_v2',
  'league_slots_v1',
  'matches_v2',
  'players_v14',
  'cup_matches',
  'match_player_effects_v1',
  'economy_transactions',
  'match_consequence_receipts',
  'market_v7',
]);

function isAllowedSourcePath(path: string): boolean {
  if (EXACT_DOCUMENT_PATHS.has(path)) return true;
  const parts = path.split('/');
  if (parts.length === 2 && DOCUMENT_COLLECTIONS.has(parts[0])) return true;
  if (parts.length === 4 &&
      parts[0] === 'cup_participant_snapshots_v1' &&
      parts[1] === 'cup_s1_lALPHA' &&
      parts[2] === 'teams' && Boolean(parts[3])) return true;
  if (parts.length === 4 &&
      parts[0] === 'league_season_archives_v1' &&
      parts[1] === 'S1' &&
      parts[2] === 'matches' && Boolean(parts[3])) return true;
  return false;
}

function isSeasonOneDocumentIdentity(path: string, data: Record<string, any>): boolean {
  const parts = path.split('/');
  const collection = parts[0];
  const id = parts[parts.length - 1];
  if (collection === 'league_tables_v2') {
    return /^table_v140_S1_LALPHA_V[1-4]_G[1-8]$/.test(id) &&
      Number(data.season) === 1 && Number(data.version) === 140 && data.leagueId === 'ALPHA';
  }
  if (collection === 'league_slots_v1') {
    return /^S1_LALPHA_D[1-4]_G[1-8]_R[1-8]$/.test(id) &&
      Number(data.season) === 1 && data.leagueId === 'ALPHA';
  }
  if (collection === 'matches_v2') {
    return /^match_v140_S1_LALPHA_V[1-4]_G[1-8]_T(?:[1-9]|1[0-4])_R[1-8]_vs_R[1-8]$/.test(id) &&
      Number(data.season) === 1 && Number(data.version) === 140 && data.leagueId === 'ALPHA';
  }
  if (collection === 'players_v14') return String(data.id || '') === id;
  if (collection === 'market_v7') return true; // Whole legacy market snapshot; no account/auth documents are included.
  if (collection === 'cup_matches') {
    return /^cup_S1_R1_M(?:0[1-9]|[1-5][0-9])$/.test(id) &&
      Number(data.season) === 1 && data.cupId === 'cup_s1_lALPHA';
  }
  if (collection === 'match_player_effects_v1' || collection === 'match_consequence_receipts') {
    return String(data.matchId || '').startsWith('match_v140_S1_LALPHA_') ||
      String(data.matchId || '').startsWith('cup_S1_');
  }
  if (collection === 'economy_transactions') {
    const referenceId = String(data.referenceId || '');
    const transactionId = id;
    return referenceId === 'S1' || referenceId === 'cup_s1_lALPHA' ||
      referenceId.startsWith('match_v140_S1_LALPHA_') || referenceId.startsWith('cup_S1_') ||
      transactionId.startsWith('match_match_v140_S1_LALPHA_') ||
      transactionId.startsWith('match_cup_S1_') ||
      transactionId.startsWith('season_1_') ||
      transactionId.startsWith('pyramid_cup_S1_');
  }
  if (collection === 'cup_pyramid_v1') return data.id === id && Number(data.season) === 1;
  if (collection === 'cup_participant_snapshots_v1') {
    return data.cupId === 'cup_s1_lALPHA' && Number(data.season) === 1 && data.teamId === id;
  }
  if (collection === 'league_season_archives_v1' && parts.length === 4) {
    return Number(data.sourceSeason) === 1;
  }
  if (collection === 'league_season_rollovers_v1') {
    return Number(data.sourceSeason) === 1 && Number(data.targetSeason) === 2;
  }
  if (collection === 'league_season_history_v1') return Number(data.season || data.sourceSeason) === 1;
  return EXACT_DOCUMENT_PATHS.has(path);
}

/** Reject paths and document identities outside the explicit Season 1 backup boundary. */
export function validateSeasonOneArchiveSources(sources: SeasonOneArchiveSource[]) {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const source of Array.isArray(sources) ? sources : []) {
    const path = String(source?.path || '');
    if (!isAllowedSourcePath(path)) {
      reasons.push('ARCHIVE_SOURCE_PATH_NOT_ALLOWLISTED');
      continue;
    }
    if (seen.has(path)) reasons.push('ARCHIVE_SOURCE_PATH_DUPLICATED');
    seen.add(path);
    if (!source.data || typeof source.data !== 'object' || Array.isArray(source.data)) {
      reasons.push('ARCHIVE_SOURCE_DOCUMENT_INVALID');
      continue;
    }
    if (!isSeasonOneDocumentIdentity(path, source.data)) {
      reasons.push('ARCHIVE_SOURCE_IDENTITY_MISMATCH');
    }
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Builds a deterministic full-document archive list; profiles are copied verbatim. */
export function buildSeasonOneArchiveEntries(sources: SeasonOneArchiveSource[]) {
  const validation = validateSeasonOneArchiveSources(sources);
  if (!validation.valid) {
    return { ready: false as const, reasons: validation.reasons, entries: [] as SeasonOneArchiveEntry[] };
  }
  const entries = sources.map(source => {
    const parts = source.path.split('/');
    return {
      sourcePath: source.path,
      sourceCollection: parts[0],
      sourceId: parts[parts.length - 1],
      data: source.data,
    };
  }).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return { ready: true as const, reasons: [] as string[], entries };
}

/** Canonical identity and cross-collection checks required before a backup is complete. */
export function validateSeasonOneArchiveCompleteness(entries: SeasonOneArchiveEntry[]) {
  const reasons: string[] = [];
  const byCollection = new Map<string, SeasonOneArchiveEntry[]>();
  for (const entry of entries) {
    const bucket = byCollection.get(entry.sourceCollection) || [];
    bucket.push(entry);
    byCollection.set(entry.sourceCollection, bucket);
  }
  const get = (collection: string) => byCollection.get(collection) || [];
  const exactIds = (actual: Set<string>, expected: Set<string>, reason: string) => {
    if (actual.size !== expected.size || [...expected].some(id => !actual.has(id))) reasons.push(reason);
  };

  const expectedTables = new Set<string>();
  const expectedSlots = new Set<string>();
  const expectedMatchKeys = new Set<string>();
  for (let level = 1; level <= 4; level++) {
    const groups = 2 ** (level - 1);
    for (let group = 1; group <= groups; group++) {
      expectedTables.add(`table_v140_S1_LALPHA_V${level}_G${group}`);
      for (let rank = 1; rank <= 8; rank++) {
        expectedSlots.add(`S1_LALPHA_D${level}_G${group}_R${rank}`);
      }
      for (let tour = 1; tour <= 14; tour++) {
        expectedMatchKeys.add(`${level}:${group}:${tour}`);
      }
    }
  }

  const tableIds = new Set(get('league_tables_v2').map(entry => entry.sourceId));
  exactIds(tableIds, expectedTables, 'ARCHIVE_TABLE_ID_SET_INVALID');
  const slotIds = new Set(get('league_slots_v1').map(entry => entry.sourceId));
  exactIds(slotIds, expectedSlots, 'ARCHIVE_SLOT_ID_SET_INVALID');

  const playerEntries = get('players_v14');
  const playerIds = new Set(playerEntries.map(entry => entry.sourceId));
  if (playerEntries.length !== 120 || playerIds.size !== 120) {
    reasons.push('ARCHIVE_PROFILE_ID_SET_INVALID');
  }

  const snapshotEntries = get('cup_participant_snapshots_v1');
  const snapshotTeamIds = new Set(snapshotEntries.map(entry => String(entry.data.teamId || '')));
  if (snapshotEntries.length !== 120 || snapshotTeamIds.size !== 120) {
    reasons.push('ARCHIVE_CUP_SNAPSHOT_ID_SET_INVALID');
  }
  exactIds(snapshotTeamIds, playerIds, 'ARCHIVE_PROFILE_SNAPSHOT_SET_MISMATCH');

  const matchEntries = get('matches_v2');
  const matchesByGroupTour = new Map<string, Set<number>>();
  for (const entry of matchEntries) {
    const match = /^match_v140_S1_LALPHA_V([1-4])_G([1-8])_T(1[0-4]|[1-9])_R([1-8])_vs_R([1-8])$/.exec(entry.sourceId);
    if (!match) {
      reasons.push('ARCHIVE_MATCH_ID_INVALID');
      continue;
    }
    const [, levelRaw, groupRaw, tourRaw, homeRaw, awayRaw] = match;
    const level = Number(levelRaw);
    const group = Number(groupRaw);
    const tour = Number(tourRaw);
    const home = Number(homeRaw);
    const away = Number(awayRaw);
    if (group > 2 ** (level - 1) || home === away) {
      reasons.push('ARCHIVE_MATCH_ID_INVALID');
      continue;
    }
    const key = `${level}:${group}:${tour}`;
    const ranks = matchesByGroupTour.get(key) || new Set<number>();
    if (ranks.has(home) || ranks.has(away)) reasons.push('ARCHIVE_MATCH_ROUND_PAIRING_INVALID');
    ranks.add(home);
    ranks.add(away);
    matchesByGroupTour.set(key, ranks);
  }
  if (matchEntries.length !== 840 || matchesByGroupTour.size !== expectedMatchKeys.size ||
      [...expectedMatchKeys].some(key => {
        const ranks = matchesByGroupTour.get(key);
        return !ranks || ranks.size !== 8;
      })) {
    reasons.push('ARCHIVE_MATCH_FIXTURE_COVERAGE_INVALID');
  }

  const expectedCupMatches = new Set(Array.from({ length: 56 }, (_, index) =>
    `cup_S1_R1_M${String(index + 1).padStart(2, '0')}`));
  const cupMatchIds = new Set(get('cup_matches').map(entry => entry.sourceId));
  exactIds(cupMatchIds, expectedCupMatches, 'ARCHIVE_CUP_FIXTURE_ID_SET_INVALID');
  if (get('cup_matches').length !== 56) reasons.push('ARCHIVE_CUP_FIXTURE_ID_SET_INVALID');
  if (get('cup_pyramid_v1').length !== 1 ||
      get('cup_pyramid_v1')[0]?.sourceId !== 'cup_s1_lALPHA') {
    reasons.push('ARCHIVE_CUP_DOCUMENT_INVALID');
  }

  if (new Set(entries.map(entry => entry.sourcePath)).size !== entries.length) {
    reasons.push('ARCHIVE_SOURCE_PATH_DUPLICATED');
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}
