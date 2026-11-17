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

  for (const entry of entries) {
    const match = entry.data || {};
    if (!isTournamentStageMatchComplete(match, stage)) return false;
    if (!Number.isSafeInteger(Number(match.index))) return false;
    const key = getTournamentStageMatchKey(match, stage, entry.id);
    if (!key || !expected.delete(key)) return false;
  }
  return expected.size === 0;
}
