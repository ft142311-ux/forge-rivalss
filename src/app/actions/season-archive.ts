import { calculateGroupStandings, hasCompleteCanonicalFixtureSet } from './season-rollover-standings';
import { buildCarryForwardGroups, expectedRolloverGroups, validateRolloverPlan } from './season-rollover-plan';

const MATCHES_PER_SEASON = 840;

function hasCompleteArchiveMetadata(archive: any): boolean {
  const sourceSeason = Number(archive?.sourceSeason);
  const integrity = archive?.integrity || {};
  return Number.isSafeInteger(sourceSeason) && sourceSeason >= 1 &&
    archive?.leagueId === 'ALPHA' && Number(archive?.archiveVersion) === 1 &&
    Number(archive?.expectedMatches) === MATCHES_PER_SEASON &&
    Number(archive?.finishedMatches) === MATCHES_PER_SEASON &&
    Number(archive?.groups) === 15 && Number(archive?.teamCount) === 120 &&
    integrity.complete === true && Number(integrity.unfinishedMatches) === 0 &&
    Number(integrity.invalidResults) === 0 &&
    Number(integrity.canonicalMatches) === MATCHES_PER_SEASON &&
    Number(integrity.duplicateCanonicalFixtures) === 0 && Boolean(archive?.finalizedAt);
}

/** Validate a persisted archive snapshot against every archived match result. */
export function validateSeasonArchiveSnapshot(archive: any, matches: any[]) {
  const reasons: string[] = [];
  if (!hasCompleteArchiveMetadata(archive)) reasons.push('ARCHIVE_METADATA_INCOMPLETE');
  if (!Array.isArray(matches) || matches.length !== MATCHES_PER_SEASON) {
    reasons.push('ARCHIVE_MATCH_COUNT_INVALID');
  }

  const matchIds = new Set<string>();
  const byGroup = new Map<string, any[]>();
  for (const match of Array.isArray(matches) ? matches : []) {
    const matchId = String(match?.matchId || match?.id || '');
    const sourceSeason = Number(match?.sourceSeason ?? archive?.sourceSeason);
    const level = Number(match?.level);
    const group = Number(match?.group);
    const homeRank = Number(match?.homeRank);
    const awayRank = Number(match?.awayRank);
    const score = match?.score || {};
    const homeScore = Number(score.home);
    const awayScore = Number(score.away);
    if (!matchId || matchIds.has(matchId) || sourceSeason !== Number(archive?.sourceSeason) ||
        Number(match?.version || 140) !== 140 || match?.isFinished !== true || match?.status !== 'finished' ||
        !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > Math.pow(2, level - 1) ||
        !match?.homeId || !match?.awayId || match.homeId === match.awayId ||
        !Number.isInteger(homeRank) || homeRank < 1 || homeRank > 8 ||
        !Number.isInteger(awayRank) || awayRank < 1 || awayRank > 8 || homeRank === awayRank ||
        ![0, 1, 2].includes(homeScore) || ![0, 1, 2].includes(awayScore) || (homeScore === 0 && awayScore === 0)) {
      reasons.push('ARCHIVE_MATCH_INVALID');
      continue;
    }
    matchIds.add(matchId);
    const key = `D${level}-G${group}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push({
      ...match,
      matchId,
      homeRank,
      awayRank,
      score: { home: homeScore, away: awayScore },
    });
  }

  const standings = archive?.standings && typeof archive.standings === 'object' ? archive.standings : {};
  const expectedGroups = expectedRolloverGroups();
  if (Object.keys(standings).length !== expectedGroups.length) reasons.push('ARCHIVE_STANDINGS_GROUP_COUNT_INVALID');
  for (const key of expectedGroups) {
    const fixtures = byGroup.get(key) || [];
    if (!hasCompleteCanonicalFixtureSet(fixtures, 8)) {
      reasons.push(`ARCHIVE_FIXTURES_INVALID:${key}`);
      continue;
    }
    const rows = standings[key];
    if (!Array.isArray(rows) || rows.length !== 8) {
      reasons.push(`ARCHIVE_STANDINGS_INVALID:${key}`);
      continue;
    }
    const computed = calculateGroupStandings({}, fixtures, 8);
    if (computed.length !== 8) {
      reasons.push(`ARCHIVE_STANDINGS_UNCOMPUTABLE:${key}`);
      continue;
    }
    const ids = new Set<string>();
    const ranks = new Set<number>();
    for (let index = 0; index < 8; index++) {
      const saved = rows[index] || {};
      const actual = computed[index];
      const id = String(saved.id || '');
      const rank = Number(saved.rank);
      if (!id || ids.has(id) || !Number.isInteger(rank) || ranks.has(rank) || rank !== index + 1 || id !== String(actual.id) ||
          ['matchesPlayed', 'wins', 'draws', 'losses', 'points', 'diff'].some(field => Number(saved[field]) !== Number((actual as any)[field]))) {
        reasons.push(`ARCHIVE_STANDINGS_MISMATCH:${key}`);
        break;
      }
      ids.add(id);
      ranks.add(rank);
    }
  }

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** An archive becomes visible only after the snapshot and its rollover plan are valid. */
export function isSeasonArchiveReadyToComplete(archive: any, matches: any[], rolloverPlan: any): boolean {
  const snapshot = validateSeasonArchiveSnapshot(archive, matches);
  const sourceSeason = Number(archive?.sourceSeason);
  return snapshot.valid &&
    validateRolloverPlan(rolloverPlan, sourceSeason, sourceSeason + 1).valid;
}

/** Client list gate: unfinished, partial, or malformed archives stay hidden. */
export function isCompletedSeasonArchive(archive: any): boolean {
  if (archive?.status !== 'completed' || !archive?.completedAt || !hasCompleteArchiveMetadata(archive)) return false;
  const standings = archive?.standings && typeof archive.standings === 'object' ? archive.standings : {};
  const expectedGroups = expectedRolloverGroups();
  if (Object.keys(standings).length !== expectedGroups.length) return false;
  const teams = new Set<string>();
  for (const key of expectedGroups) {
    const rows = standings[key];
    if (!Array.isArray(rows) || rows.length !== 8) return false;
    const ranks = new Set<number>();
    for (const row of rows) {
      const id = String(row?.id || '');
      const rank = Number(row?.rank);
      if (!id || teams.has(id) || !Number.isInteger(rank) || rank < 1 || rank > 8 || ranks.has(rank)) return false;
      teams.add(id);
      ranks.add(rank);
    }
    if (ranks.size !== 8) return false;
  }
  return teams.size === 120;
}

/**
 * A recovery archive is a truthful record of a closed calendar season whose
 * final table could not be reconstructed. It is intentionally never accepted
 * by the completed-season or rollover gates.
 */
export function isRecoveredSeasonArchive(archive: any): boolean {
  if (archive?.status !== 'recovered' || archive?.recovery?.status !== 'incomplete' ||
      archive?.recovery?.finalStandingsAvailable !== false || !archive?.recoveredAt ||
      !Number.isSafeInteger(Number(archive?.sourceSeason)) || Number(archive.sourceSeason) < 1 ||
      archive?.leagueId !== 'ALPHA' || Number(archive?.archiveVersion) !== 1 ||
      Number(archive?.expectedMatches) !== MATCHES_PER_SEASON ||
      !archive?.standings || typeof archive.standings !== 'object' || Object.keys(archive.standings).length !== 0) return false;
  const participants = archive?.startingParticipants;
  if (!participants || typeof participants !== 'object') return false;
  const expected = expectedRolloverGroups();
  const ids = new Set<string>();
  for (const group of expected) {
    const rows = participants[group];
    if (!Array.isArray(rows) || rows.length !== 8) return false;
    for (const row of rows) {
      const id = String(row?.id || '');
      const rank = Number(row?.rank);
      if (!id || ids.has(id) || !Number.isInteger(rank) || rank < 1 || rank > 8) return false;
      ids.add(id);
    }
  }
  return ids.size === 120 && Number(archive.finishedMatches || 0) <= MATCHES_PER_SEASON &&
    Number(archive.unresolvedMatches || 0) === MATCHES_PER_SEASON - Number(archive.finishedMatches || 0);
}

function getUniqueSeasonArchives(
  archives: any[],
  isIncluded: (archive: any) => boolean,
): any[] {
  const bySeason = new Map<number, any>();
  for (const archive of Array.isArray(archives) ? archives : []) {
    if (!isIncluded(archive)) continue;
    const season = Number(archive.sourceSeason);
    if (!bySeason.has(season)) bySeason.set(season, archive);
  }
  return [...bySeason.values()].sort((a, b) => Number(b.sourceSeason) - Number(a.sourceSeason));
}

export function getVisibleSeasonArchives(archives: any[]): any[] {
  return getUniqueSeasonArchives(
    archives,
    archive => isCompletedSeasonArchive(archive) || isRecoveredSeasonArchive(archive),
  );
}

export function getCompletedSeasonArchives(archives: any[]): any[] {
  return getUniqueSeasonArchives(archives, isCompletedSeasonArchive);
}


/**
 * Validate the complete archive-retention set before deleting anything.
 * A PRUNING marker is written only after this function has approved the set;
 * it makes interrupted subcollection deletion safely resumable.
 */
export function resolveArchivePrunePlan(
  archives: Array<{ id: string; archive: any; matches: any[]; historyStatus?: string | null }>,
  targetSeason: number,
  retainedArchiveSeason: number | null,
) {
  if (!Number.isSafeInteger(targetSeason) || targetSeason < 2 ||
      (retainedArchiveSeason !== null && (!Number.isSafeInteger(retainedArchiveSeason) ||
        retainedArchiveSeason < 1 || retainedArchiveSeason >= targetSeason))) {
    return { ready: false as const, reason: 'ARCHIVE_PRUNE_TARGET_INVALID', pruneIds: [] as string[] };
  }
  const completedSeasons: number[] = [];
  const pruneIds: string[] = [];
  let retainedFound = retainedArchiveSeason === null;

  for (const item of archives) {
    const match = /^S([1-9]\d*)$/.exec(String(item.id || ''));
    const season = match ? Number(match[1]) : NaN;
    const archive = item.archive || {};
    if (!Number.isSafeInteger(season) || season >= targetSeason ||
        Number(archive.sourceSeason) !== season) {
      return { ready: false as const, reason: 'ARCHIVE_PRUNE_IDENTITY_CONFLICT', archiveId: item.id, pruneIds: [] as string[] };
    }

    if (isCompletedSeasonArchive(archive)) {
      completedSeasons.push(season);
      if (season === retainedArchiveSeason) {
        retainedFound = true;
        if (archive.pruneStatus === 'PRUNING') {
          return { ready: false as const, reason: 'RETAINED_ARCHIVE_MARKED_FOR_PRUNING', archiveId: item.id, pruneIds: [] as string[] };
        }
        const validation = validateSeasonArchiveSnapshot(archive, item.matches || []);
        if (!validation.valid) {
          return { ready: false as const, reason: 'RETAINED_ARCHIVE_INVALID', archiveId: item.id, details: validation.reasons, pruneIds: [] as string[] };
        }
        continue;
      }
      if (archive.pruneStatus === 'PRUNING') {
        if (Number(archive.pruneTargetSeason) !== targetSeason ||
            Number(archive.pruneRetainedArchiveSeason || 0) !== Number(retainedArchiveSeason || 0) ||
            Number(archive.prunePolicyVersion) !== 1) {
          return { ready: false as const, reason: 'ARCHIVE_PRUNE_MARKER_CONFLICT', archiveId: item.id, pruneIds: [] as string[] };
        }
      } else {
        const validation = validateSeasonArchiveSnapshot(archive, item.matches || []);
        if (!validation.valid) {
          return { ready: false as const, reason: 'OBSOLETE_COMPLETED_ARCHIVE_INVALID', archiveId: item.id, details: validation.reasons, pruneIds: [] as string[] };
        }
      }
      pruneIds.push(item.id);
      continue;
    }

    if (isRecoveredSeasonArchive(archive)) {
      if (archive.pruneStatus === 'PRUNING') {
        if (Number(archive.pruneTargetSeason) !== targetSeason ||
            Number(archive.pruneRetainedArchiveSeason || 0) !== Number(retainedArchiveSeason || 0) ||
            Number(archive.prunePolicyVersion) !== 1) {
          return { ready: false as const, reason: 'ARCHIVE_PRUNE_MARKER_CONFLICT', archiveId: item.id, pruneIds: [] as string[] };
        }
      } else if (!['SKIPPED', 'SKIPPED_PENDING_ACTIVATION'].includes(String(item.historyStatus || ''))) {
        return { ready: false as const, reason: 'RECOVERED_ARCHIVE_SKIP_MARKER_MISSING', archiveId: item.id, pruneIds: [] as string[] };
      }
      pruneIds.push(item.id);
      continue;
    }

    return { ready: false as const, reason: 'UNKNOWN_OR_INCOMPLETE_ARCHIVE_CANNOT_BE_PRUNED', archiveId: item.id, pruneIds: [] as string[] };
  }

  if (retainedArchiveSeason !== null && !retainedFound) {
    return { ready: false as const, reason: 'RETAINED_ARCHIVE_MISSING', pruneIds: [] as string[] };
  }
  const latestCompleted = completedSeasons.length ? Math.max(...completedSeasons) : null;
  if (latestCompleted !== retainedArchiveSeason) {
    return { ready: false as const, reason: 'LATEST_COMPLETED_ARCHIVE_RETENTION_CONFLICT', latestCompleted, retainedArchiveSeason, pruneIds: [] as string[] };
  }
  return { ready: true as const, reason: null, pruneIds, retainedArchiveSeason };
}


/**
 * Persist a truthful record for a season that could not be completed.
 * This snapshot contains only its starting team placements; it deliberately
 * has no final standings, match scores, rewards, or promotion decisions.
 */
export function buildRecoveredSeasonArchiveSnapshot(input: {
  sourceSeason: number;
  startingParticipants: Record<string, any[]>;
  finishedMatches: number;
  reason: string;
  recoveredAt?: string;
}) {
  const sourceSeason = Number(input?.sourceSeason);
  const finishedMatches = Number(input?.finishedMatches);
  if (!Number.isSafeInteger(sourceSeason) || sourceSeason < 1 ||
      !Number.isInteger(finishedMatches) || finishedMatches < 0 || finishedMatches > MATCHES_PER_SEASON ||
      !String(input?.reason || '').trim()) {
    return { ready: false as const, reason: 'RECOVERED_ARCHIVE_METADATA_INVALID' };
  }
  const participants = buildCarryForwardGroups(input.startingParticipants || {});
  if (!participants.ready) {
    return { ready: false as const, reason: participants.reason, group: participants.group };
  }
  const recoveredAt = input.recoveredAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(recoveredAt))) {
    return { ready: false as const, reason: 'RECOVERED_ARCHIVE_TIMESTAMP_INVALID' };
  }
  return {
    ready: true as const,
    archive: {
      sourceSeason,
      leagueId: 'ALPHA',
      archiveVersion: 1,
      status: 'recovered',
      recoveredAt,
      expectedMatches: MATCHES_PER_SEASON,
      finishedMatches,
      unresolvedMatches: MATCHES_PER_SEASON - finishedMatches,
      groups: 15,
      teamCount: 120,
      standings: {},
      startingParticipants: participants.groups,
      recovery: {
        status: 'incomplete',
        finalStandingsAvailable: false,
        reason: String(input.reason),
      },
    },
  };
}
