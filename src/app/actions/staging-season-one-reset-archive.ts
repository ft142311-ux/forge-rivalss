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

/** Reject paths outside the explicit Season 1 backup boundary. */
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

/** Canonical source counts required before a backup may be called complete. */
export function validateSeasonOneArchiveCompleteness(entries: SeasonOneArchiveEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.sourceCollection, (counts.get(entry.sourceCollection) || 0) + 1);
  }
  const expected: Record<string, number> = {
    league_tables_v2: 15,
    league_slots_v1: 120,
    matches_v2: 840,
    players_v14: 120,
    cup_pyramid_v1: 1,
    cup_matches: 56,
  };
  const reasons = Object.entries(expected)
    .filter(([collection, count]) => counts.get(collection) !== count)
    .map(([collection]) => `ARCHIVE_CORE_SOURCE_COUNT_INVALID:${collection}`);

  const cupSnapshots = entries.filter(entry =>
    entry.sourcePath.startsWith('cup_participant_snapshots_v1/cup_s1_lALPHA/teams/'));
  if (cupSnapshots.length !== 120) reasons.push('ARCHIVE_CUP_SNAPSHOT_COUNT_INVALID');
  if (new Set(entries.map(entry => entry.sourcePath)).size !== entries.length) {
    reasons.push('ARCHIVE_SOURCE_PATH_DUPLICATED');
  }
  return { valid: reasons.length === 0, reasons };
}
