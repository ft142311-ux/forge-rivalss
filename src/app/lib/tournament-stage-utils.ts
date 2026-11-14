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
