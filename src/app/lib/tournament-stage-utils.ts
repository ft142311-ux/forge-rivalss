export function isTournamentStageMatchComplete(match: any, stage: string): boolean {
  if (match?.status !== 'finished' || !match?.homeId || !match?.awayId || match.homeId === match.awayId) {
    return false;
  }
  // Group BO2 fixtures can draw; every knockout fixture must have a valid winner.
  if (stage !== 'groups' && !match.winnerId) return false;
  if (match.winnerId && ![match.homeId, match.awayId].includes(match.winnerId)) return false;
  return true;
}

export function getTournamentStageMatchKey(match: any, stage: string, fallbackId: string): string | null {
  if (stage === 'groups') {
    const groupId = String(match?.groupId || '').trim();
    const round = Number(match?.round);
    const index = match?.index;
    if (!groupId || !Number.isInteger(round) || round < 1 || index == null) return null;
    return `groups:${groupId}:${round}:${String(index)}`;
  }
  const index = match?.index ?? fallbackId;
  return `${stage}:${String(index)}`;
}

export function isTournamentStageMatchSetComplete(
  entries: Array<{ id: string; data: any }>,
  stage: string,
  maxParticipants: number,
  groupTeamsById?: Record<string, readonly string[]>,
): boolean {
  if (![16, 32].includes(maxParticipants)) return false;

  let expectedCount = 0;
  if (stage === 'groups') expectedCount = (maxParticipants / 4) * 6;
  else if (stage === 'round_of_16') expectedCount = maxParticipants === 32 ? 8 : 0;
  else if (stage === 'quarterfinal') expectedCount = 4;
  else if (stage === 'semifinal') expectedCount = 2;
  else if (stage === 'final') expectedCount = 1;
  if (expectedCount === 0 || entries.length !== expectedCount) return false;

  const expected = new Set<string>();
  if (stage === 'groups') {
    const groups = maxParticipants / 4;
    for (let group = 0; group < groups; group++) {
      const groupId = String.fromCharCode(65 + group);
      for (let round = 1; round <= 3; round++) {
        for (let index = 1; index <= 2; index++) {
          expected.add(`groups:${groupId}:${round}:${index}`);
        }
      }
    }
  } else {
    for (let index = 1; index <= expectedCount; index++) {
      expected.add(`${stage}:${index}`);
    }
  }

  if (stage === 'groups') {
    const expectedGroupCount = maxParticipants / 4;
    const expectedGroupIds = Array.from(
      { length: expectedGroupCount },
      (_, index) => String.fromCharCode(65 + index),
    );
    if (!groupTeamsById || Object.keys(groupTeamsById).length !== expectedGroupCount) return false;

    const allTeamIds = new Set<string>();
    for (const groupId of expectedGroupIds) {
      const teamIds = groupTeamsById[groupId];
      if (!Array.isArray(teamIds) || teamIds.length !== 4) return false;
      const normalizedTeamIds = teamIds.map(id => String(id || '').trim());
      if (normalizedTeamIds.some(id => !id) || new Set(normalizedTeamIds).size !== 4) return false;
      for (const id of normalizedTeamIds) {
        if (allTeamIds.has(id)) return false;
        allTeamIds.add(id);
      }
    }
    if (allTeamIds.size !== maxParticipants) return false;

    // A valid key matrix alone is not enough: malformed fixtures could repeat
    // one team twice in a round and silently omit another. Every four-team
    // group must play a complete round-robin pairing in each of its 3 rounds.
    for (const groupId of expectedGroupIds) {
      const groupTeamIds = new Set((groupTeamsById[groupId] || []).map(id => String(id || '').trim()));
      const playedPairs = new Set<string>();
      for (let round = 1; round <= 3; round += 1) {
        const roundEntries = entries.filter(entry =>
          String(entry.data?.groupId || '') === groupId &&
          Number(entry.data?.round) === round
        );
        if (roundEntries.length !== 2) return false;

        const roundTeamIds = new Set<string>();
        for (const entry of roundEntries) {
          const match = entry.data || {};
          const homeId = String(match.homeId || '').trim();
          const awayId = String(match.awayId || '').trim();
          if (!groupTeamIds.has(homeId) || !groupTeamIds.has(awayId) || homeId === awayId ||
              roundTeamIds.has(homeId) || roundTeamIds.has(awayId)) return false;
          roundTeamIds.add(homeId);
          roundTeamIds.add(awayId);

          const pairKey = [homeId, awayId].sort().join(':');
          if (playedPairs.has(pairKey)) return false;
          playedPairs.add(pairKey);
        }
        if (roundTeamIds.size !== 4 || [...groupTeamIds].some(id => !roundTeamIds.has(id))) return false;
      }
      // Three rounds of two fixtures must cover all six unique pairings.
      if (playedPairs.size !== 6) return false;
    }
  }

  if (stage !== 'groups') {
    // Every knockout participant must appear in exactly one fixture in this
    // stage. Otherwise a duplicate team can advance twice while another
    // qualifier silently disappears from the bracket.
    const stageParticipantIds = new Set<string>();
    for (const entry of entries) {
      const match = entry.data || {};
      const homeId = String(match.homeId || '').trim();
      const awayId = String(match.awayId || '').trim();
      if (!homeId || !awayId || homeId === awayId ||
          stageParticipantIds.has(homeId) || stageParticipantIds.has(awayId)) return false;
      stageParticipantIds.add(homeId);
      stageParticipantIds.add(awayId);
    }
    if (stageParticipantIds.size !== expectedCount * 2) return false;
  }

  for (const entry of entries) {
    const match = entry.data || {};
    if (!isTournamentStageMatchComplete(match, stage)) return false;
    if (!Number.isSafeInteger(Number(match.index))) return false;
    const key = getTournamentStageMatchKey(match, stage, entry.id);
    if (!key || !expected.delete(key)) return false;
  }
  return expected.size === 0;
}
export type TournamentGroupOutcome = 'home_win' | 'draw' | 'away_win';

/**
 * Group standings are decided by the BO2 series result, not the aggregate
 * in-game score. A 1-1 split remains a draw even when the two game scores
 * do not add up to equal totals.
 */
export function resolveTournamentGroupOutcome(
  winnerSide: unknown,
  homeId: unknown,
  awayId: unknown,
): TournamentGroupOutcome | null {
  const home = String(homeId || '').trim();
  const away = String(awayId || '').trim();
  if (!home || !away || home === away) return null;
  if (winnerSide === 'home') return 'home_win';
  if (winnerSide === 'away') return 'away_win';
  if (winnerSide === 'draw') return 'draw';
  return null;
}
