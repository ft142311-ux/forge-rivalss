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
function isHistoricalFixture(fixture: any): boolean {
  const status = String(fixture?.status || '').toLowerCase();
  return fixture?.isFinished === true || status === 'finished' || status === 'completed';
}

function collectFixtureIdentityMaps(fixtures: any[], teamsPerGroup = 8) {
  const allIdsByRank = new Map<number, Set<string>>();
  const activeByRank = new Map<number, string>();
  const activeConflicts = new Set<number>();
  const namesByRank = new Map<number, string>();

  for (const fixture of fixtures || []) {
    for (const [idValue, rankValue, nameValue] of [
      [fixture?.homeId, fixture?.homeRank, fixture?.homeName],
      [fixture?.awayId, fixture?.awayRank, fixture?.awayName],
    ] as [any, any, any][]) {
      const id = String(idValue || '');
      const rank = Number(rankValue);
      if (!id || !Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup) continue;
      if (!allIdsByRank.has(rank)) allIdsByRank.set(rank, new Set());
      allIdsByRank.get(rank)!.add(id);
      if (nameValue && !namesByRank.has(rank)) namesByRank.set(rank, String(nameValue));

      if (!isHistoricalFixture(fixture)) {
        const previous = activeByRank.get(rank);
        if (previous && previous !== id) activeConflicts.add(rank);
        else activeByRank.set(rank, id);
      }
    }
  }
  return { allIdsByRank, activeByRank, activeConflicts, namesByRank };
}

function collectSourceRowsByRank(sourceStats: Record<string, any>, teamsPerGroup = 8) {
  const rowsByRank = new Map<number, Array<{ key: string; id: string; row: any }>>();
  for (const [key, row] of Object.entries(sourceStats || {})) {
    const id = String(row?.id || key);
    const rank = Number(row?.rank);
    if (!id || !Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup) continue;
    if (!rowsByRank.has(rank)) rowsByRank.set(rank, []);
    rowsByRank.get(rank)!.push({ key, id, row: row || {} });
  }
  return rowsByRank;
}

export function hasCompleteCanonicalFixtureSet(fixtures: any[], teamsPerGroup = 8): boolean {
  if (!hasCanonicalFixtureStructure(fixtures, teamsPerGroup)) return false;

  return fixtures.every((fixture: any) => {
    const homeScore = Number(fixture?.score?.home ?? fixture?.seriesScore?.home ?? fixture?.scoreA);
    const awayScore = Number(fixture?.score?.away ?? fixture?.seriesScore?.away ?? fixture?.scoreB);
    const status = String(fixture?.status || '').toLowerCase();
    return Number.isInteger(homeScore) && Number.isInteger(awayScore) &&
      homeScore >= 0 && homeScore <= 2 && awayScore >= 0 && awayScore <= 2 &&
      (homeScore !== 0 || awayScore !== 0) &&
      fixture?.isFinished === true &&
      (fixture?.status === undefined || status === 'finished' || status === 'completed');
  });
}

/** Keep pending fixtures out of standings calculations during an active season. */
export function selectFinishedFixtures(fixtures: any[]): any[] {
  return Array.isArray(fixtures)
    ? fixtures.filter((fixture: any) => fixture?.isFinished === true)
    : [];
}

/**
 * Validate the immutable round-robin shape without requiring results yet.
 * Rollover uses this gate before settling overdue matches; the final gate uses
 * hasCompleteCanonicalFixtureSet() after settlement.
 */
/**
 * Validate the immutable round-robin shape. A rank may have multiple historical
 * participant IDs across completed fixtures after owner rotation, but all
 * unfinished fixtures for that rank must use one current participant.
 */
export function hasCanonicalFixtureStructure(fixtures: any[], teamsPerGroup = 8): boolean {
  const expected = teamsPerGroup * (teamsPerGroup - 1);
  if (!Array.isArray(fixtures) || fixtures.length !== expected) return false;

  const coordinates = new Set<string>();
  const participantRankById = new Map<string, number>();
  const appearancesByRank = new Map<number, number>();
  const activeParticipantByRank = new Map<number, string>();

  for (const fixture of fixtures) {
    const homeId = String(fixture?.homeId || '');
    const awayId = String(fixture?.awayId || '');
    const homeRank = Number(fixture?.homeRank);
    const awayRank = Number(fixture?.awayRank);
    if (!homeId || !awayId || homeId === awayId ||
        !Number.isInteger(homeRank) || !Number.isInteger(awayRank) ||
        homeRank < 1 || homeRank > teamsPerGroup ||
        awayRank < 1 || awayRank > teamsPerGroup ||
        homeRank === awayRank) return false;

    const coordinate = `${homeRank}>${awayRank}`;
    if (coordinates.has(coordinate)) return false;
    coordinates.add(coordinate);

    for (const [id, rank] of [[homeId, homeRank], [awayId, awayRank]] as [string, number][]) {
      const previousRank = participantRankById.get(id);
      if (previousRank !== undefined && previousRank !== rank) return false;
      participantRankById.set(id, rank);
      appearancesByRank.set(rank, (appearancesByRank.get(rank) || 0) + 1);

      if (!isHistoricalFixture(fixture)) {
        const activeId = activeParticipantByRank.get(rank);
        if (activeId && activeId !== id) return false;
        activeParticipantByRank.set(rank, id);
      }
    }
  }

  return coordinates.size === expected &&
    appearancesByRank.size === teamsPerGroup &&
    [...appearancesByRank.values()].every(count => count === 2 * (teamsPerGroup - 1));
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
  sourceStats: Record<string, any> = {},
): CanonicalSlotRepair[] | null {
  if (!hasCanonicalFixtureStructure(fixtures, teamsPerGroup)) return null;
  if (!Array.isArray(slots) || slots.length !== teamsPerGroup) return null;

  const slotByRank = new Map<number, any>();
  for (const slot of slots) {
    const rank = Number(slot?.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup || slotByRank.has(rank)) return null;
    slotByRank.set(rank, slot);
  }
  if (slotByRank.size !== teamsPerGroup) return null;

  const sourceByRank = collectSourceRowsByRank(sourceStats, teamsPerGroup);
  const { allIdsByRank, activeByRank, activeConflicts } = collectFixtureIdentityMaps(fixtures, teamsPerGroup);
  if (activeConflicts.size) return null;

  const repairs: CanonicalSlotRepair[] = [];
  for (let rank = 1; rank <= teamsPerGroup; rank++) {
    const slot = slotByRank.get(rank) || {};
    const status = String(slot.status || '');
    const slotId = String(slot.occupantId || '');
    const entries = sourceByRank.get(rank) || [];
    const activeId = activeByRank.get(rank);

    // Unfinished fixtures are the authoritative participant binding for the
    // next match; unlike completed fixtures, they cannot represent a prior owner.
    if (activeId) {
      const matching = entries.find(entry => entry.id === activeId);
      if (entries.length && !matching) return null;
      const isBot = matching?.row?.isBot === true || activeId.startsWith('BOT_');
      repairs.push({
        rank,
        occupantId: isBot ? null : activeId,
        status: isBot ? 'FREE' : 'OCCUPIED',
      });
      continue;
    }

    if (status === 'OCCUPIED' && slotId) {
      const matching = entries.find(entry => entry.id === slotId);
      if (entries.length && (!matching || matching.row?.isBot === true)) return null;
      if (activeId && activeId !== slotId) return null;
      repairs.push({ rank, occupantId: slotId, status: 'OCCUPIED' });
      continue;
    }

    if (status === 'FREE' && !slotId) {
      const botEntry = entries.find(entry => entry.row?.isBot === true || entry.id.startsWith('BOT_'));
      if (entries.length && !botEntry) return null;
      if (activeId && !activeId.startsWith('BOT_')) return null;
      if (botEntry && activeId && botEntry.id !== activeId) return null;
      const historicalIds = allIdsByRank.get(rank);
      const historicalBotId = historicalIds?.size === 1 && [...historicalIds][0].startsWith('BOT_')
        ? [...historicalIds][0]
        : null;
      if (!botEntry && !activeId && !historicalBotId) return null;
      repairs.push({ rank, occupantId: null, status: 'FREE' });
      continue;
    }

    if (!status && slotId) {
      const matching = entries.find(entry => entry.id === slotId);
      if (entries.length && (!matching || matching.row?.isBot === true)) return null;
      if (activeId && activeId !== slotId) return null;
      repairs.push({ rank, occupantId: slotId, status: 'OCCUPIED' });
      continue;
    }

    if (!status && !slotId) {
      if (entries.length > 1) return null;
      const entry = entries[0];
      const currentId = entry?.id || activeId;
      if (currentId) {
        const isBot = entry?.row?.isBot === true || currentId.startsWith('BOT_');
        if (activeId && activeId !== currentId) return null;
        repairs.push({
          rank,
          occupantId: isBot ? null : currentId,
          status: isBot ? 'FREE' : 'OCCUPIED',
        });
        continue;
      }
      return null;
    }

    return null;
  }
  return repairs;
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
  const sourceByRank = collectSourceRowsByRank(sourceStats, teamsPerGroup);
  const { allIdsByRank, activeByRank, activeConflicts } = collectFixtureIdentityMaps(fixtures, teamsPerGroup);
  const slotByRank = new Map<number, any>();
  const duplicateSlotRanks = new Set<number>();
  for (const slot of slots || []) {
    const rank = Number(slot?.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup) continue;
    if (slotByRank.has(rank)) duplicateSlotRanks.add(rank);
    slotByRank.set(rank, slot);
  }

  const sourceEntries = Object.entries(sourceStats || {}).map(([key, row]) => ({
    key,
    id: String(row?.id || key),
    rank: Number(row?.rank),
    row: row || {},
  }));
  const sourceIds = sourceEntries.map(entry => entry.id).filter(Boolean);
  const sourceRanks = sourceEntries.map(entry => entry.rank).filter(rank => Number.isInteger(rank));
  const staleRows = new Set<string>();
  const slotConflicts: GroupReconciliation['slotConflicts'] = [];
  const unresolvedRanks: number[] = [];

  for (const entry of sourceEntries) {
    if (!entry.id || entry.key !== entry.id ||
        !Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > teamsPerGroup) {
      staleRows.add(entry.id || entry.key);
    }
  }

  for (let rank = 1; rank <= teamsPerGroup; rank++) {
    const entries = sourceByRank.get(rank) || [];
    const slot = slotByRank.get(rank);
    const activeId = activeByRank.get(rank);
    const historicalIds = allIdsByRank.get(rank) || new Set<string>();
    const status = String(slot?.status || '');
    const slotId = String(slot?.occupantId || '');
    let expectedId = '';

    if (status === 'OCCUPIED' && slotId) {
      expectedId = slotId;
    } else if (status === 'FREE') {
      expectedId = entries.find(entry => entry.row?.isBot === true || entry.id.startsWith('BOT_'))?.id ||
        (activeId?.startsWith('BOT_') ? activeId : '');
    } else if (slotId) {
      expectedId = slotId;
    } else if (entries.length === 1) {
      expectedId = entries[0].id;
    } else if (activeId) {
      expectedId = activeId;
    } else if (historicalIds.size === 1) {
      expectedId = [...historicalIds][0];
    } else if (entries.length > 1) {
      expectedId = entries[0].id;
    }

    const selected = expectedId ? entries.find(entry => entry.id === expectedId) : undefined;
    if (entries.length > 1 && !selected) {
      for (const entry of entries) staleRows.add(entry.id);
    } else {
      for (const entry of entries) {
        if (entry !== selected && expectedId && entry.id !== expectedId) staleRows.add(entry.id);
      }
    }

    const hasBotSource = entries.some(entry => entry.row?.isBot === true || entry.id.startsWith('BOT_'));
    const slotHasCurrentIdentity = (status === 'OCCUPIED' && Boolean(slotId)) ||
      status === 'FREE' || (!status && Boolean(slotId));
    if ((!expectedId && (historicalIds.size > 1 || entries.length > 1)) ||
        (!slotHasCurrentIdentity && !activeId && entries.length !== 1 && historicalIds.size > 1) ||
        (status === 'FREE' && !hasBotSource && !(activeId?.startsWith('BOT_')) &&
          !(historicalIds.size === 1 && [...historicalIds][0].startsWith('BOT_')))) {
      unresolvedRanks.push(rank);
    }
    if (activeId && expectedId && activeId !== expectedId) {
      slotConflicts.push({ rank, fixtureParticipantId: activeId, slotParticipantId: slotId });
      continue;
    }

    if (!slot) continue;
    let conflict = false;
    if (status === 'OCCUPIED') {
      conflict = !slotId ||
        (entries.length > 0 && !selected) ||
        (selected ? selected.id !== slotId || selected.row?.isBot === true : false) ||
        (activeId ? activeId !== slotId : false);
    } else if (status === 'FREE') {
      conflict = Boolean(slotId) ||
        (entries.length > 0 && !selected) ||
        (selected ? !(selected.row?.isBot === true || selected.id.startsWith('BOT_')) : false) ||
        (activeId ? !activeId.startsWith('BOT_') : false);
    } else if (!status) {
      if (slotId) {
        conflict = (entries.length > 0 && !selected) ||
          (selected ? selected.id !== slotId : false) ||
          (activeId ? activeId !== slotId : false);
      } else {
        conflict = (entries.length > 0 && !selected) ||
          (selected ? !(selected.row?.isBot === true || selected.id.startsWith('BOT_')) : false) ||
          (activeId ? !activeId.startsWith('BOT_') : false);
      }
    } else {
      conflict = true;
    }

    if (conflict) {
      const fixtureParticipantId = expectedId || activeId || (historicalIds.size === 1 ? [...historicalIds][0] : '');
      slotConflicts.push({ rank, fixtureParticipantId, slotParticipantId: slotId });
    }
  }

  const reasons: string[] = [];
  if (!completeFixtures) reasons.push('INCOMPLETE_OR_AMBIGUOUS_FIXTURES');
  if (staleRows.size) reasons.push('STALE_STANDINGS_ROWS');
  if (slots.length !== teamsPerGroup || slotByRank.size !== teamsPerGroup) reasons.push('INCOMPLETE_SLOT_SET');
  if (duplicateSlotRanks.size) reasons.push('DUPLICATE_SLOT_RANKS');
  if (new Set(sourceIds).size !== sourceIds.length) reasons.push('SOURCE_DUPLICATE_ID');
  if (new Set(sourceRanks).size !== sourceRanks.length) reasons.push('SOURCE_DUPLICATE_RANK');
  if (activeConflicts.size) reasons.push('CURRENT_FIXTURE_PARTICIPANT_CONFLICT');
  if (unresolvedRanks.length) reasons.push('CURRENT_SLOT_OWNER_UNRESOLVED');
  if (slotConflicts.length) reasons.push('SLOT_FIXTURE_PARTICIPANT_MISMATCH');

  let standings: TeamRow[] = [];
  try {
    standings = calculateGroupStandings(sourceStats, fixtures, teamsPerGroup, slots);
  } catch {
    standings = [];
  }

  return {
    ready: completeFixtures && slots.length === teamsPerGroup &&
      slotByRank.size === teamsPerGroup && duplicateSlotRanks.size === 0 &&
      slotConflicts.length === 0 && staleRows.size === 0 && reasons.length === 0,
    completeFixtures,
    fixtureStructureComplete,
    standings,
    staleRows: [...staleRows],
    slotConflicts,
    reasons,
  };
}

/** Rebuild final places from the fixture participants and scores. */
export function calculateGroupStandings(
  sourceStats: Record<string, any>,
  fixtures: any[],
  teamsPerGroup = 8,
  slots: any[] = [],
): TeamRow[] {
  const completeFixtures = hasCompleteCanonicalFixtureSet(fixtures, teamsPerGroup);
  const sourceByRank = collectSourceRowsByRank(sourceStats, teamsPerGroup);
  const { allIdsByRank, activeByRank, activeConflicts, namesByRank } = collectFixtureIdentityMaps(fixtures, teamsPerGroup);
  if (activeConflicts.size) throw new Error('CURRENT_FIXTURE_PARTICIPANT_CONFLICT');

  const slotByRank = new Map<number, any>();
  for (const slot of slots || []) {
    const rank = Number(slot?.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > teamsPerGroup) continue;
    if (slotByRank.has(rank)) throw new Error('DUPLICATE_SLOT_RANK');
    slotByRank.set(rank, slot);
  }

  const rowsByRank = new Map<number, TeamRow>();
  const ranksToBuild = completeFixtures
    ? Array.from({ length: teamsPerGroup }, (_, index) => index + 1)
    : [...new Set([
        ...sourceByRank.keys(),
        ...activeByRank.keys(),
        ...allIdsByRank.keys(),
        ...slotByRank.keys(),
      ])].sort((a, b) => a - b);
  for (const rank of ranksToBuild) {
    const entries = sourceByRank.get(rank) || [];
    const slot = slotByRank.get(rank);
    const status = String(slot?.status || '');
    const slotId = String(slot?.occupantId || '');
    const activeId = activeByRank.get(rank);
    const historicalIds = allIdsByRank.get(rank) || new Set<string>();
    let selected = null as { key: string; id: string; row: any } | null;

    if (status === 'OCCUPIED' && slotId) {
      selected = entries.find(entry => entry.id === slotId) || null;
      if (entries.length && !selected) throw new Error(`SLOT_STANDINGS_OWNER_MISMATCH_R${rank}`);
      if (!selected) selected = { key: slotId, id: slotId, row: { id: slotId } };
    } else if (status === 'FREE' && !slotId) {
      selected = entries.find(entry => entry.row?.isBot === true || entry.id.startsWith('BOT_')) || null;
      if (!selected && activeId?.startsWith('BOT_')) {
        selected = entries.find(entry => entry.id === activeId) ||
          { key: activeId, id: activeId, row: { id: activeId, isBot: true } };
      }
      if (!selected && historicalIds.size === 1 && [...historicalIds][0].startsWith('BOT_')) {
        const id = [...historicalIds][0];
        selected = entries.find(entry => entry.id === id) || { key: id, id, row: { id, isBot: true } };
      }
      if (!selected) throw new Error(`FREE_SLOT_BOT_ID_UNRESOLVED_R${rank}`);
    } else if (!status && slotId) {
      selected = entries.find(entry => entry.id === slotId) || { key: slotId, id: slotId, row: { id: slotId } };
    } else if (entries.length === 1) {
      selected = entries[0];
    } else if (activeId) {
      selected = entries.find(entry => entry.id === activeId) ||
        { key: activeId, id: activeId, row: { id: activeId, isBot: activeId.startsWith('BOT_') } };
    } else if (historicalIds.size === 1) {
      const id = [...historicalIds][0];
      selected = entries.find(entry => entry.id === id) || { key: id, id, row: { id, isBot: id.startsWith('BOT_') } };
    } else if (entries.length > 1) {
      if (historicalIds.size > 1) throw new Error(`CURRENT_SLOT_OWNER_UNRESOLVED_R${rank}`);
      selected = entries[0];
    }

    if (!selected) throw new Error(`CURRENT_SLOT_OWNER_UNRESOLVED_R${rank}`);
    if (activeId && activeId !== selected.id) throw new Error(`CURRENT_FIXTURE_OWNER_MISMATCH_R${rank}`);

    const row = cleanRow(selected.id, {
      ...(selected.row || {}),
      id: selected.id,
      name: selected.row?.name || namesByRank.get(rank) || selected.id,
      rank,
      isBot: selected.row?.isBot === true || selected.id.startsWith('BOT_'),
    });
    rowsByRank.set(rank, row);
  }

  // Match outcomes are aggregated by rank (the permanent league slot), never
  // by historical owner ID. The source row supplies the current owner identity.
  for (const fixture of fixtures || []) {
    const homeRank = Number(fixture?.homeRank);
    const awayRank = Number(fixture?.awayRank);
    const home = rowsByRank.get(homeRank);
    const away = rowsByRank.get(awayRank);
    if (!home || !away) throw new Error('CANONICAL_SLOT_ROW_MISSING');

    const homeScore = Number(fixture.score?.home ?? fixture.seriesScore?.home ?? fixture.scoreA);
    const awayScore = Number(fixture.score?.away ?? fixture.seriesScore?.away ?? fixture.scoreB);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    home.matchesPlayed++;
    away.matchesPlayed++;
    home.diff += homeScore - awayScore;
    away.diff += awayScore - homeScore;
    if (homeScore > awayScore) { home.wins++; home.points += 3; away.losses++; }
    else if (awayScore > homeScore) { away.wins++; away.points += 3; home.losses++; }
    else { home.draws++; away.draws++; home.points++; away.points++; }
  }

  const sorted = [...rowsByRank.values()].sort(compareTeams);
  return completeFixtures ? sorted.slice(0, teamsPerGroup) : sorted;
}
