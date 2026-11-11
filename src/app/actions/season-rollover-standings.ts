type TeamRow = Record<string, any>;

function compareTeams(a: TeamRow, b: TeamRow) {
  return Number(b.points || 0) - Number(a.points || 0)
    || Number(b.diff || 0) - Number(a.diff || 0)
    || Number(b.wins || 0) - Number(a.wins || 0)
    || String(a.name || a.id).localeCompare(String(b.name || b.id))
    || String(a.id).localeCompare(String(b.id));
}

function cleanRow(id: string, row: any): TeamRow {
  return { ...row, id, name: String(row?.name || row?.clubName || id), matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0 };
}

/**
 * A source row may be removed only after the complete canonical round-robin
 * result set is present.  During catch-up or partial repair, absence from the
 * currently loaded fixtures is not evidence that a registered team is stale.
 */
export function hasCompleteCanonicalFixtureSet(fixtures: any[], teamsPerGroup = 8): boolean {
  if (!hasCanonicalFixtureStructure(fixtures, teamsPerGroup)) return false;

  return fixtures.every((fixture: any) => {
    const homeScore = Number(fixture?.score?.home ?? fixture?.seriesScore?.home ?? fixture?.scoreA);
    const awayScore = Number(fixture?.score?.away ?? fixture?.seriesScore?.away ?? fixture?.scoreB);
    return Number.isInteger(homeScore) && Number.isInteger(awayScore) &&
      homeScore >= 0 && homeScore <= 2 && awayScore >= 0 && awayScore <= 2 &&
      (homeScore !== 0 || awayScore !== 0) &&
      fixture?.isFinished === true &&
      (fixture?.status === undefined || String(fixture.status).toLowerCase() === 'finished');
  });
}

/** Keep pending fixtures out of standings calculations during an active season. */
export function selectFinishedFixtures(fixtures: any[]): any[] {
  return Array.isArray(fixtures) ? fixtures.filter((fixture: any) => fixture?.isFinished === true) : [];
}

/**
 * Validate the immutable round-robin shape without requiring results yet.
 * Rollover uses this gate before settling overdue matches; the final gate uses
 * hasCompleteCanonicalFixtureSet() after settlement.
 */
export function hasCanonicalFixtureStructure(fixtures: any[], teamsPerGroup = 8): boolean {
  const expected = teamsPerGroup * (teamsPerGroup - 1);
  if (!Array.isArray(fixtures) || fixtures.length !== expected) return false;

  const coordinates = new Set<string>();
  const participants = new Map<string, { rank: number; matches: number }>();
  for (const fixture of fixtures) {
    const homeId = String(fixture?.homeId || '');
    const awayId = String(fixture?.awayId || '');
    const homeRank = Number(fixture?.homeRank);
    const awayRank = Number(fixture?.awayRank);
    if (!homeId || !awayId || homeId === awayId ||
        !Number.isInteger(homeRank) || !Number.isInteger(awayRank) ||
        homeRank < 1 || homeRank > teamsPerGroup || awayRank < 1 || awayRank > teamsPerGroup ||
        homeRank === awayRank) return false;

    const coordinate = `${homeRank}>${awayRank}`;
    if (coordinates.has(coordinate)) return false;
    coordinates.add(coordinate);
    for (const [id, rank] of [[homeId, homeRank], [awayId, awayRank]] as [string, number][]) {
      const current = participants.get(id);
      if (current && current.rank !== rank) return false;
      participants.set(id, { rank, matches: (current?.matches || 0) + 1 });
    }
  }

  if (coordinates.size !== expected || participants.size !== teamsPerGroup) return false;
  const ranks = [...participants.values()].map(item => item.rank);
  return new Set(ranks).size === teamsPerGroup &&
    ranks.every(rank => rank >= 1 && rank <= teamsPerGroup) &&
    [...participants.values()].every(item => item.matches === 2 * (teamsPerGroup - 1));
}

export type CanonicalSlotRepair = {
  rank: number;
  occupantId: string | null;
  status: 'FREE' | 'OCCUPIED';
};

/**
 * Build a deterministic slot projection from a structurally complete canonical
 * fixture set. Returns null rather than guessing when fixture or slot structure
 * is ambiguous. Bot participants are represented by FREE slots (null occupant).
 */
export function buildCanonicalSlotRepairs(
  fixtures: any[],
  slots: any[],
  teamsPerGroup = 8,
): CanonicalSlotRepair[] | null {
  if (!hasCanonicalFixtureStructure(fixtures, teamsPerGroup)) return null;
  if (!Array.isArray(slots) || slots.length !== teamsPerGroup) return null;

  const slotRanks = slots.map(slot => Number(slot?.rank));
  if (new Set(slotRanks).size !== teamsPerGroup ||
      !slotRanks.every(rank => Number.isInteger(rank) && rank >= 1 && rank <= teamsPerGroup)) {
    return null;
  }

  const participantByRank = new Map<number, string>();
  for (const fixture of fixtures) {
    for (const [id, rank] of [[fixture?.homeId, fixture?.homeRank], [fixture?.awayId, fixture?.awayRank]] as [any, any][]) {
      const participantId = String(id || '');
      const participantRank = Number(rank);
      if (!participantId || !Number.isInteger(participantRank)) return null;
      const previous = participantByRank.get(participantRank);
      if (previous && previous !== participantId) return null;
      participantByRank.set(participantRank, participantId);
    }
  }
  if (participantByRank.size !== teamsPerGroup) return null;

  return Array.from({ length: teamsPerGroup }, (_, index) => {
    const rank = index + 1;
    const participantId = participantByRank.get(rank);
    if (!participantId) throw new Error(`Missing canonical participant for rank ${rank}`);
    const isBot = participantId.startsWith('BOT_');
    return { rank, occupantId: isBot ? null : participantId, status: isBot ? 'FREE' as const : 'OCCUPIED' as const };
  });
}

export type GroupReconciliation = {
  ready: boolean;
  completeFixtures: boolean;
  fixtureStructureComplete: boolean;
  standings: TeamRow[];
  staleRows: string[];
  slotConflicts: Array<{
    rank: number;
    fixtureParticipantId: string;
    slotParticipantId: string;
  }>;
  reasons: string[];
  recoveryRequired?: boolean;
  recoveryReasons?: string[];
  recoveryStaleRows?: string[];
  recoverySlotConflicts?: Array<{ rank: number; fixtureParticipantId: string; slotParticipantId: string }>;
};

export function evaluateRolloverPreflight(
  inspections: Array<Pick<GroupReconciliation, 'completeFixtures' | 'fixtureStructureComplete' | 'slotConflicts' | 'reasons'> & { group?: string }>,
  options: { allowUnfinished?: boolean } = {},
) {
  const failed = inspections.filter(item => {
    const unfinishedOnly = options.allowUnfinished === true &&
      item.fixtureStructureComplete &&
      !item.completeFixtures &&
      item.reasons.every(reason => reason === 'INCOMPLETE_OR_AMBIGUOUS_FIXTURES');
    return (!item.completeFixtures && !unfinishedOnly) || item.slotConflicts.length > 0 || item.reasons.some(reason => reason !== 'INCOMPLETE_OR_AMBIGUOUS_FIXTURES' || !unfinishedOnly);
  });
  return {
    ready: failed.length === 0,
    reason: failed.some(item => item.slotConflicts.length > 0)
      ? 'SEASON_STANDINGS_SLOTS_FIXTURE_CONFLICT'
      : failed.length ? 'SEASON_STANDINGS_PREFLIGHT_FAILED' : null,
    failedGroups: failed.map(item => item.group || 'unknown'),
  };
}

/**
 * Compare a table projection and registration slots with the completed
 * fixtures. This is deliberately read-only and never chooses a historical
 * slot placement on behalf of the caller.
 */
export function inspectGroupReconciliation(
  sourceStats: Record<string, any>,
  fixtures: any[],
  slots: any[] = [],
  teamsPerGroup = 8,
): GroupReconciliation {
  const fixtureStructureComplete = hasCanonicalFixtureStructure(fixtures, teamsPerGroup);
  const completeFixtures = hasCompleteCanonicalFixtureSet(fixtures, teamsPerGroup);
  const fixtureByRank = new Map<number, string>();
  for (const fixture of fixtures || []) {
    for (const [id, rank] of [[fixture?.homeId, fixture?.homeRank], [fixture?.awayId, fixture?.awayRank]] as [any, any][]) {
      const participantId = String(id || '');
      const participantRank = Number(rank);
      if (participantId && Number.isInteger(participantRank) && !fixtureByRank.has(participantRank)) {
        fixtureByRank.set(participantRank, participantId);
      }
    }
  }

  const sourceRows = Object.values(sourceStats || {}) as any[];
  const fixtureIds = new Set(fixtureByRank.values());
  const sourceIds = sourceRows.map(row => String(row?.id || '')).filter(Boolean);
  const sourceRanks = sourceRows.map(row => Number(row?.rank)).filter(rank => Number.isInteger(rank));
  const staleRows = sourceRows
    .filter(row => row && row.id && fixtureStructureComplete && !fixtureIds.has(String(row.id)))
    .map(row => String(row.id));
  const slotConflicts: GroupReconciliation['slotConflicts'] = [];
  for (const slot of slots || []) {
    const rank = Number(slot?.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup) continue;
    const fixtureParticipantId = fixtureByRank.get(rank) || '';
    const slotParticipantId = String(slot?.occupantId || '');
    if (!fixtureParticipantId) continue;
    if (fixtureParticipantId.startsWith('BOT_')) {
      if (slotParticipantId) slotConflicts.push({ rank, fixtureParticipantId, slotParticipantId });
    } else if (slotParticipantId !== fixtureParticipantId) {
      slotConflicts.push({ rank, fixtureParticipantId, slotParticipantId });
    }
  }

  const reasons: string[] = [];
  if (!completeFixtures) reasons.push('INCOMPLETE_OR_AMBIGUOUS_FIXTURES');
  if (staleRows.length) reasons.push('STALE_STANDINGS_ROWS');
  if (slots.length !== teamsPerGroup) reasons.push('INCOMPLETE_SLOT_SET');
  if (new Set(sourceIds).size !== sourceIds.length) reasons.push('SOURCE_DUPLICATE_ID');
  if (new Set(sourceRanks).size !== sourceRanks.length) reasons.push('SOURCE_DUPLICATE_RANK');
  if (slotConflicts.length) reasons.push('SLOT_FIXTURE_PARTICIPANT_MISMATCH');
  return {
    ready: completeFixtures && slots.length === teamsPerGroup && slotConflicts.length === 0 && reasons.length === 0,
    completeFixtures,
    fixtureStructureComplete,
    standings: calculateGroupStandings(sourceStats, fixtures, teamsPerGroup),
    staleRows,
    slotConflicts,
    reasons,
  };
}

/** Rebuild final places from the fixture participants and scores. */
export function calculateGroupStandings(sourceStats: Record<string, any>, fixtures: any[], teamsPerGroup = 8): TeamRow[] {
  const completeFixtures = hasCompleteCanonicalFixtureSet(fixtures, teamsPerGroup);
  const rows = new Map<string, TeamRow>();
  const byRank = new Map<number, [string, any]>();

  for (const [id, row] of Object.entries(sourceStats || {})) {
    const rank = Number(row?.rank);
    if (!completeFixtures && Number.isInteger(rank) && rank >= 1 && rank <= teamsPerGroup && id) {
      rows.set(id, cleanRow(id, { ...row, rank }));
    } else if (Number.isInteger(rank) && rank >= 1 && rank <= teamsPerGroup && !byRank.has(rank)) {
      byRank.set(rank, [id, row]);
    }
  }
  if (completeFixtures) {
    for (let rank = 1; rank <= teamsPerGroup; rank++) {
      const entry = byRank.get(rank);
      if (entry) rows.set(entry[0], cleanRow(entry[0], { ...entry[1], rank }));
    }
  }

  const ensure = (id: string, name: string, rank: number) => {
    if (!Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup) {
      throw new Error(`Non-canonical team rank for ${id}: ${rank}`);
    }
    const existing = [...rows.values()].find(row => Number(row.rank) === rank);
    if (completeFixtures && existing && String(existing.id) !== id) rows.delete(String(existing.id));
    if (!rows.has(id)) rows.set(id, cleanRow(id, { id, name, rank, isBot: id.startsWith('BOT_') }));
    const row = rows.get(id)!;
    row.rank = rank;
    row.name = row.name || name;
    return row;
  };

  for (const fixture of fixtures) {
    const homeScore = Number(fixture.score?.home ?? fixture.seriesScore?.home ?? fixture.scoreA);
    const awayScore = Number(fixture.score?.away ?? fixture.seriesScore?.away ?? fixture.scoreB);
    const home = ensure(String(fixture.homeId), String(fixture.homeName || fixture.homeId), Number(fixture.homeRank));
    const away = ensure(String(fixture.awayId), String(fixture.awayName || fixture.awayId), Number(fixture.awayRank));
    home.matchesPlayed++;
    away.matchesPlayed++;
    home.diff += homeScore - awayScore;
    away.diff += awayScore - homeScore;
    if (homeScore > awayScore) { home.wins++; home.points += 3; away.losses++; }
    else if (awayScore > homeScore) { away.wins++; away.points += 3; home.losses++; }
    else { home.draws++; away.draws++; home.points++; away.points++; }
  }

  const sorted = [...rows.values()].sort(compareTeams);
  return completeFixtures ? sorted.slice(0, teamsPerGroup) : sorted;
}
